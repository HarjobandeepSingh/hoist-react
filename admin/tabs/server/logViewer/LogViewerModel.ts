/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2023 Extremely Heavy Industries Inc.
 */
import {exportFilenameWithDate} from '@xh/hoist/admin/AdminUtils';
import {AppModel} from '@xh/hoist/admin/AppModel';
import {GridModel} from '@xh/hoist/cmp/grid';
import {HoistModel, LoadSpec, managed, XH} from '@xh/hoist/core';
import {RecordActionSpec} from '@xh/hoist/data';
import {compactDateRenderer, fmtNumber} from '@xh/hoist/format';
import {Icon} from '@xh/hoist/icon';
import {makeObservable, observable} from '@xh/hoist/mobx';
import download from 'downloadjs';
import {createRef} from 'react';
import {LogDisplayModel} from './LogDisplayModel';

/**
 * @internal
 */
export class LogViewerModel extends HoistModel {
    @observable file: string = null;

    viewRef = createRef<HTMLElement>();

    @managed
    logDisplayModel = new LogDisplayModel(this);

    @managed
    filesGridModel: GridModel;

    get enabled(): boolean {
        return XH.getConf('xhEnableLogViewer', true);
    }

    get selectedRecord() {
        return this.filesGridModel.selectedRecord;
    }

    deleteFileAction: RecordActionSpec = {
        text: 'Delete',
        icon: Icon.delete(),
        intent: 'danger',
        recordsRequired: true,
        actionFn: () => this.deleteSelectedAsync(),
        displayFn: () => ({hidden: AppModel.readonly})
    };

    downloadFileAction: RecordActionSpec = {
        text: 'Download',
        icon: Icon.download(),
        recordsRequired: 1,
        actionFn: () => this.downloadSelectedAsync()
    };

    constructor() {
        super();
        makeObservable(this);

        this.filesGridModel = this.createGridModel();

        this.addReaction({
            track: () => this.selectedRecord,
            run: rec => {
                this.file = rec?.data?.filename;
            }
        });
    }

    override async doLoadAsync(loadSpec: LoadSpec) {
        const {enabled, filesGridModel} = this;
        if (!enabled) return;

        const store = filesGridModel.store,
            selModel = filesGridModel.selModel;

        try {
            const data = await XH.fetchJson({
                url: 'logViewerAdmin/listFiles',
                loadSpec
            });

            this.logDisplayModel.logRootPath = data.logRootPath;

            store.loadData(data.files);
            if (selModel.isEmpty) {
                const latestAppLog = store.records.find(
                    rec => rec.data.filename === `${XH.appCode}.log`
                );
                if (latestAppLog) {
                    selModel.select(latestAppLog);
                }
            }
        } catch (e) {
            XH.handleException(e, {title: 'Error loading list of available log files'});
        }
    }

    async deleteSelectedAsync() {
        try {
            const recs = this.filesGridModel.selectedRecords,
                count = recs.length;
            if (!count) return;

            const confirmed = await XH.confirm({
                title: 'Please Confirm',
                message: `Delete ${count} log files on the server? This cannot be undone.`
            });
            if (!confirmed) return;

            const filenames = recs.map(r => r.data.filename);
            await XH.fetch({
                url: 'logViewerAdmin/deleteFiles',
                params: {filenames}
            });
            await this.refreshAsync();
        } catch (e) {
            XH.handleException(e);
        }
    }

    async downloadSelectedAsync() {
        try {
            const {selectedRecord} = this;
            if (!selectedRecord) return;

            const {filename} = selectedRecord.data,
                response = await XH.fetch({
                    url: 'logViewerAdmin/download',
                    params: {filename}
                });

            const blob = await response.blob();
            download(blob, filename);

            XH.toast({
                icon: Icon.download(),
                message: 'Download complete.'
            });
        } catch (e) {
            XH.handleException(e);
        }
    }

    //---------------------------------
    // Implementation
    //---------------------------------
    private createGridModel() {
        return new GridModel({
            enableExport: true,
            exportOptions: {filename: exportFilenameWithDate('logs')},
            selModel: 'multiple',
            store: {
                idSpec: 'filename',
                fields: [
                    {name: 'filename', type: 'string', displayName: 'Name'},
                    {name: 'size', type: 'number', displayName: 'Size'},
                    {name: 'lastModified', type: 'number', displayName: 'Modified'}
                ]
            },
            sortBy: 'lastModified|desc',
            columns: [
                {field: 'filename', flex: 1, minWidth: 160},
                {
                    field: 'size',
                    width: 80,
                    renderer: fileSizeRenderer
                },
                {
                    field: 'lastModified',
                    width: 110,
                    renderer: compactDateRenderer({sameDayFmt: 'HH:mm:ss'})
                }
            ],
            autosizeOptions: {mode: 'managed'},
            contextMenu: [
                this.downloadFileAction,
                this.deleteFileAction,
                '-',
                ...GridModel.defaultContextMenu
            ]
        });
    }
}

function fileSizeRenderer(v) {
    if (v == null) return '';

    const inMb = v > 1000000,
        scale = inMb ? 1 / 1000000 : 1 / 1000;

    return fmtNumber(v * scale, {
        precision: 1,
        originalValue: v,
        tooltip: true,
        label: inMb ? 'mb' : 'kb'
    });
}
