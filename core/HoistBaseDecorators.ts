/*
 * This file belongs to Hoist, an application development toolkit
 * developed by Extremely Heavy Industries (www.xh.io | info@xh.io)
 *
 * Copyright © 2023 Extremely Heavy Industries Inc.
 */
import {cloneDeep, isUndefined} from 'lodash';
import {wait} from '../promise';
import {logError, throwIf} from '../utils/js';
import {HoistBaseClass, PersistenceProvider, PersistOptions} from './';

/**
 * Decorator to make a property "managed". Managed properties are designed to hold objects that
 * are created by the referencing object and that implement a `destroy()` method.
 *
 * @see HoistBase.markManaged
 */
export const managed: any = (target: HoistBaseClass, property: string, descriptor: any) => {
    throwIf(!target.isHoistBase, '@managed decorator should be applied to a subclass of HoistBase');
    // Be sure to create list for *this* particular class. Clone and include inherited values.
    const key = '_xhManagedProperties';
    if (!target.hasOwnProperty(key)) {
        target[key] = [...(target[key] ?? [])];
    }
    target[key].push(property);
    return descriptor;
};

/**
 * Decorator to make a class property persistent.
 *
 * This decorator provides the same functionality as {@link HoistBase.markPersist}. See that method
 * for more details.
 *
 * This decorator should always be applied "before" the mobx decorator, i.e. second in file line
 * order: `@bindable @persist fooBarFlag = true`
 *
 * See also `@persist.with`, a higher-order version of this decorator that allows for setting
 * property-specific persistence options.
 */
export const persist: any = (target: HoistBaseClass, property: string, descriptor: any) => {
    return createPersistDescriptor(target, property, descriptor, null);
};

/**
 * Decorator to make a class property persistent. This is a higher-order version of `@persist`.
 * Use this variant as a function to provide custom PersistOptions.
 */
persist.with = function (options: PersistOptions): any {
    return function (target, property, descriptor) {
        return createPersistDescriptor(target, property, descriptor, options);
    };
};

//---------------------
// Implementation
//---------------------
function createPersistDescriptor(
    target: HoistBaseClass,
    property: string,
    descriptor: any,
    options: PersistOptions
) {
    throwIf(
        !target.isHoistBase,
        '@persist decorator should be applied to an instance of HoistBase'
    );
    if (descriptor.get || descriptor.set) {
        logError(
            `Error defining ${property} : @persist or @persistWith should be defined closest ` +
                `to property, and after mobx annotation e.g. '@bindable @persist ${property}'`,
            target
        );
        return descriptor;
    }
    const codeValue = descriptor.initializer;
    const initializer = function () {
        let providerState;

        // Read from and attach to Provider.
        // Fail gently -- initialization exceptions causes stack overflows for MobX.
        try {
            const persistWith = {path: property, ...this.persistWith, ...options},
                provider = this.markManaged(PersistenceProvider.create(persistWith));
            providerState = cloneDeep(provider.read());
            wait().then(() => {
                this.addReaction({
                    track: () => this[property],
                    run: data => provider.write(data)
                });
            });
        } catch (e) {
            logError(
                [
                    `Failed to configure Persistence for '${property}'.  Be sure to fully specify ` +
                        `'persistWith' on this object or annotation`,
                    e
                ],
                target
            );
        }

        // 2) Return data from provider data *or* code, if provider not yet set or failed
        return !isUndefined(providerState) ? providerState : codeValue?.call(this);
    };
    return {...descriptor, initializer};
}
