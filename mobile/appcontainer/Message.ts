/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2023 Extremely Heavy Industries Inc.
 */
import {MessageModel} from '@xh/hoist/appcontainer/MessageModel';
import {form} from '@xh/hoist/cmp/form';
import {div, filler} from '@xh/hoist/cmp/layout';
import {hoistCmp, uses} from '@xh/hoist/core';
import {button} from '@xh/hoist/mobile/cmp/button';
import {dialog} from '@xh/hoist/mobile/cmp/dialog';
import {formField} from '@xh/hoist/mobile/cmp/form';
import {textInput} from '@xh/hoist/mobile/cmp/input';
import {withDefault} from '@xh/hoist/utils/js';
import './Message.scss';

/**
 * Renders a modal dialog.
 * @internal
 */
export const message = hoistCmp.factory({
    displayName: 'Message',
    model: uses(MessageModel),

    render({model}) {
        const isOpen = model?.isOpen,
            {icon, title, message, formModel, confirmProps, cancelProps, cancelAlign} = model,
            buttons = [];

        if (!isOpen) return null;

        if (cancelProps) {
            buttons.push(button({minimal: true, ...cancelProps}));
        }

        if (cancelProps || confirmProps) {
            if (cancelAlign === 'left') {
                buttons.push(filler());
            } else {
                buttons.unshift(filler());
            }
        }

        if (confirmProps) {
            // Merge in formModel.isValid here in render stage to get reactivity.
            buttons.push(
                formModel
                    ? button({...confirmProps, disabled: !formModel.isValid})
                    : button(confirmProps)
            );
        }

        return dialog({
            isOpen,
            icon,
            title,
            buttons,
            className: 'xh-message',
            content: div(
                div({omit: !message, className: 'xh-message-content', item: message}),
                inputCmp()
            ),
            isCancelable: model.dismissable,
            onCancel: () => model.doEscape()
        });
    }
});

const inputCmp = hoistCmp.factory<MessageModel>(({model}) => {
    const {formModel, input} = model;
    if (!formModel) return null;
    return form({
        fieldDefaults: {commitOnChange: true, minimal: true, label: null},
        item: formField({
            field: 'value',
            item: withDefault(input.item, textInput())
        })
    });
});
