/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2023 Extremely Heavy Industries Inc.
 */
import {HoistService, XH} from '@xh/hoist/core';
import {Icon} from '@xh/hoist/icon';
import {action, makeObservable, observable} from '@xh/hoist/mobx';
import {Timer} from '@xh/hoist/utils/async';
import {SECONDS} from '@xh/hoist/utils/datetime';
import {throwIf} from '@xh/hoist/utils/js';
import {find, pull} from 'lodash';

/**
 * Establishes and maintains a websocket connection to the Hoist server, if enabled via `AppSpec`.
 *
 * Once a connection is established, this service exposes a `channelKey` property that is unique to
 * this user and client app instance. This key can be used in application-specific requests to the
 * server to identify this unique client app instance / connection. The server can then push
 * messages as requested - e.g. when a particular query or dataset of interest is updated.
 *
 * Callers can register a callback via `subscribe()` to receive incoming messages on a requested
 * topic. The {@link WebSocketSubscription} returned from `subscribe()` can be used to later
 * `unsubscribe()` if updates are no longer desired. `HoistModel` and `HoistComponent` callers are
 * encouraged to save a reference to their subscription via a {@link managed} property to have
 * callbacks unsubscribed automatically when the component/model is unmounted/destroyed.
 *
 * This service also provides a `sendMessage()` method to push messages back to the server over the
 * same socket, although this is a relatively uncommon usage and is specifically *not* recommended
 * over plain-old Ajax requests.
 *
 * Note this service requires the server-side application to be configured to listen to inbound
 * websocket connections. See `WebSocketService.groovy` in hoist-core for additional documentation.
 *
 * See {@link WebSocketIndicator}, a simple component for displaying connection status.
 */
export class WebSocketService extends HoistService {
    static instance: WebSocketService;

    HEARTBEAT_TOPIC = 'xhHeartbeat';
    REG_SUCCESS_TOPIC = 'xhRegistrationSuccess';
    FORCE_APP_SUSPEND_TOPIC = 'xhForceAppSuspend';

    /** Unique channel assigned by server upon successful connection. */
    @observable
    channelKey: string = null;

    /** Last time a message was received, including heartbeat messages. */
    @observable
    lastMessageTime: Date = null;

    /** Observable flag indicating service is connected and available for use. */
    get connected(): boolean {
        return !!this.channelKey;
    }

    /** Set to true to log all sent/received messages - very chatty. */
    logMessages: boolean = false;

    private _timer: Timer;
    private _socket: WebSocket;
    private _subsByTopic = {};

    enabled: boolean = XH.appSpec.webSocketsEnabled;

    constructor() {
        super();
        makeObservable(this);
    }

    override async initAsync() {
        if (!this.enabled) return;
        if (XH.environmentService.get('webSocketsEnabled') === false) {
            this.logError(
                `WebSockets enabled on this client app but disabled on server. Adjust your server-side config.`
            );
            this.enabled = false;
            return;
        }

        this.connect();

        this._timer = Timer.create({
            runFn: () => this.heartbeatOrReconnect(),
            interval: 10 * SECONDS,
            delay: true
        });
    }

    /**
     * Subscribe a callback to receive inbound messages for a given topic on a going-forward basis.
     *
     * @param topic - application-specific topic of interest.
     * @param fn - handler to call for each incoming message on the requested topic.
     * @returns subscription reference that can be used to unsubscribe to future messages for the
     *      same topic/handler. Callers should take care to save this reference and use it to
     *      dispose of their subs on destroy.
     */
    subscribe(topic: string, fn: (msg: WebSocketMessage) => any): WebSocketSubscription {
        const subs = this.getSubsForTopic(topic),
            existingSub = find(subs, {fn});

        if (existingSub) return existingSub;

        const newSub = new WebSocketSubscription(topic, fn);
        subs.push(newSub);
        return newSub;
    }

    /**
     * Cancel a subscription for a given topic/handler.
     *
     * @param subscription - WebSocketSubscription returned when the subscription was established.
     */
    unsubscribe(subscription: WebSocketSubscription) {
        const subs = this.getSubsForTopic(subscription.topic);
        pull(subs, subscription);
    }

    /**
     * Send a message back to the server via the connected websocket.
     */
    sendMessage(message: WebSocketMessage) {
        this.updateConnectedStatus();
        throwIf(!this.connected, 'Unable to send message via websocket - not connected.');

        this._socket.send(JSON.stringify(message));
        this.maybeLogMessage('Sent message', message);
    }

    //------------------------
    // Implementation
    //------------------------
    connect() {
        try {
            // Create new socket and wire up events.  Be sure to ignore obsolete sockets
            const s = new WebSocket(this.buildWebSocketUrl());
            s.onopen = ev => {
                if (s === this._socket) this.onOpen(ev);
            };
            s.onclose = ev => {
                if (s === this._socket) this.onClose(ev);
            };
            s.onerror = ev => {
                if (s === this._socket) this.onError(ev);
            };
            s.onmessage = data => {
                if (s === this._socket) this.onMessage(data);
            };
            this._socket = s;
        } catch (e) {
            this.logError('Failure creating WebSocket', e);
        }

        this.updateConnectedStatus();
    }

    disconnect() {
        if (this._socket) {
            this._socket.close();
            this._socket = null;
        }
        this.updateConnectedStatus();
    }

    heartbeatOrReconnect() {
        this.updateConnectedStatus();
        if (this.connected) {
            this.sendMessage({topic: this.HEARTBEAT_TOPIC, data: 'ping'});
        } else {
            this.logWarn('Heartbeat found websocket not connected - attempting to reconnect...');
            this.disconnect();
            this.connect();
        }
    }

    shutdown() {
        if (this._timer) this._timer.cancel();
        this.disconnect();
    }

    //------------------------
    // Socket events impl
    //------------------------
    onOpen(ev) {
        this.logDebug('WebSocket connection opened', ev);
        this.updateConnectedStatus();
    }

    onClose(ev) {
        this.logDebug('WebSocket connection closed', ev);
        this.updateConnectedStatus();
    }

    onError(ev) {
        this.logError('WebSocket connection error', ev);
        this.updateConnectedStatus();
    }

    onMessage(rawMsg) {
        try {
            const msg = JSON.parse(rawMsg.data),
                {topic, data} = msg;

            // Record arrival
            this.updateLastMessageTime();
            this.maybeLogMessage('Received message', rawMsg);

            // Hoist and app handling
            switch (topic) {
                case this.REG_SUCCESS_TOPIC:
                    this.installChannelKey(data.channelKey);
                    break;
                case this.FORCE_APP_SUSPEND_TOPIC:
                    XH.suspendApp({reason: 'SERVER_FORCE', message: data});
                    XH.track({category: 'App', message: 'App suspended via WebSocket'});
                    break;
            }

            this.notifySubscribers(msg);
        } catch (e) {
            this.logError('Error decoding websocket message', rawMsg, e);
        }
        this.updateConnectedStatus();
    }

    //------------------------
    // Subscription impl
    //------------------------
    notifySubscribers(message) {
        const subs = this.getSubsForTopic(message.topic);

        subs.forEach(sub => {
            try {
                sub.fn(message);
            } catch (e) {
                this.logError(`Handler for topic ${message.topic} threw`, e);
            }
        });
    }

    getSubsForTopic(topic): WebSocketSubscription[] {
        let ret = this._subsByTopic[topic];
        if (!ret) {
            ret = this._subsByTopic[topic] = [];
        }
        return ret;
    }

    //------------------------
    // Other impl
    //------------------------
    updateConnectedStatus() {
        const socketOpen = this._socket?.readyState === WebSocket.OPEN;
        if (!socketOpen && this.channelKey) {
            this.installChannelKey(null);
        }
    }

    @action
    installChannelKey(key) {
        this.channelKey = key;
    }

    @action
    updateLastMessageTime() {
        this.lastMessageTime = new Date();
    }

    buildWebSocketUrl() {
        const protocol = window.location.protocol == 'https:' ? 'wss:' : 'ws:',
            endpoint = 'xhWebSocket';

        return XH.isDevelopmentMode
            ? `${protocol}//${XH.baseUrl.split('//')[1]}${endpoint}`
            : `${protocol}//${window.location.host}${XH.baseUrl}${endpoint}`;
    }

    showTestMessageAlert(message) {
        XH.alert({
            title: 'Test Message',
            icon: Icon.bullhorn(),
            message
        });
    }

    maybeLogMessage(...args) {
        if (this.logMessages) this.logDebug(args);
    }
}

/**
 * Wrapper class to encapsulate and manage a subscription to messages for a given topic + handler.
 * Returned from `WebSocketService.subscribe()` and used to `unsubscribe()`.
 */
export class WebSocketSubscription {
    topic: string;
    fn: (msg: WebSocketMessage) => any;

    constructor(topic, fn) {
        this.topic = topic;
        this.fn = fn;
    }

    destroy() {
        XH.webSocketService.unsubscribe(this);
    }
}

export interface WebSocketMessage {
    topic: string;
    data?: any;
}
