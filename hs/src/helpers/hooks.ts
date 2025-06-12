type AfterCallback = (prop: string, result: any, args: any[]) => void;
const functionCallbacks: Record<string, AfterCallback[]> = {};

export const proxiedGlobals = new Proxy<Record<string, any>>({}, {
    set(target, prop, value) {
        const key = String(prop);

        if (typeof value === 'function' && !value.__wrapped) {
            console.log(`[HOOK] Function '${key}' registered for monitored execution`);

            const originalFn = value;

            const wrappedFn = async (...args: any[]) => {
                const maybePromise = originalFn.apply(this, args);

                // Always return a promise to simplify uniform handling
                return Promise.resolve(maybePromise).then(result => {
                    if (functionCallbacks[key]) {
                        for (const cb of functionCallbacks[key]) {
                            cb(key, result, args);
                        }
                    }
                    return result;
                });
            };

            Object.defineProperty(wrappedFn, "__wrapped", {
                value: true,
                enumerable: false,
            });

            target[key] = wrappedFn;
        } else {
            target[key] = value;
        }

        return true;
    }
});

export const registerFunctionCallback = ( functionName: string, callback: AfterCallback ) => {
    if (!functionCallbacks[functionName]) {
        functionCallbacks[functionName] = [];
    }
    functionCallbacks[functionName].push(callback);
}

