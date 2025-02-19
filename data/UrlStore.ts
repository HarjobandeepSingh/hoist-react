/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2023 Extremely Heavy Industries Inc.
 */

import {XH, managed, LoadSupport, LoadSpec, Loadable, PlainObject} from '@xh/hoist/core';

import {Store, StoreConfig} from './Store';

export interface UrlStoreConfig extends StoreConfig {
    /** URL from which to load data. */
    url: string;

    /** Property name (key) of the object returned by URL from which to extract record data. */
    dataRoot?: string;
}

/**
 * A store with built-in support for loading data from a URL.
 */
export class UrlStore extends Store implements Loadable {
    url: string;
    dataRoot: string;

    @managed
    loadSupport: LoadSupport = new LoadSupport(this);

    constructor({url, dataRoot = null, ...storeConfig}: UrlStoreConfig) {
        super(storeConfig);
        this.url = url;
        this.dataRoot = dataRoot;
    }

    get loadModel() {
        return this.loadSupport.loadModel;
    }
    get lastLoadRequested() {
        return this.loadSupport.lastLoadRequested;
    }
    get lastLoadCompleted() {
        return this.loadSupport.lastLoadCompleted;
    }
    get lastLoadException() {
        return this.loadSupport.lastLoadException;
    }
    async refreshAsync(meta?: PlainObject) {
        return this.loadSupport.refreshAsync(meta);
    }
    async autoRefreshAsync(meta?: PlainObject) {
        return this.loadSupport.autoRefreshAsync(meta);
    }
    async loadAsync(loadSpec?: LoadSpec | Partial<LoadSpec>) {
        return this.loadSupport.loadAsync(loadSpec);
    }

    /** @internal - call loadAsync() instead. */
    async doLoadAsync(loadSpec: LoadSpec): Promise<void> {
        const {url, dataRoot} = this;
        let data = await XH.fetchJson({url, loadSpec});
        if (dataRoot) data = data[dataRoot];
        this.loadData(data);
    }
}
