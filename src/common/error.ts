// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import { Assert } from ".";
import { DefaultTemplates, ILocalizationTemplates, Localization } from "../localization";
import { ICancellationToken } from "./cancellationToken/ICancellationToken";

export type TInnerCommonError = CancellationError | InvariantError | UnknownError;

export class CommonError extends Error {
    constructor(readonly innerError: TInnerCommonError) {
        super(innerError.message);
        Object.setPrototypeOf(this, CommonError.prototype);
    }
}

export class CancellationError extends Error {
    constructor(readonly cancellationToken: ICancellationToken) {
        super(Localization.error_common_cancellationError(DefaultTemplates));
        Object.setPrototypeOf(this, CancellationError.prototype);
    }
}

export class InvariantError extends Error {
    constructor(readonly invariantBroken: string, readonly maybeDetails: any | undefined = undefined) {
        super(Localization.error_common_invariantError(DefaultTemplates, invariantBroken, maybeDetails));
        Object.setPrototypeOf(this, InvariantError.prototype);
    }
}

export class UnknownError extends Error {
    constructor(templates: ILocalizationTemplates, readonly innerError: any) {
        super(Localization.error_common_unknown(templates, innerError));
        Object.setPrototypeOf(this, UnknownError.prototype);
    }
}

export function assertIsCommonError(error: any): error is CommonError {
    Assert.isTrue(isCommonError(error), "isCommonError(error)");
    return true;
}

export function isCommonError(error: any): error is CommonError {
    return error instanceof CommonError;
}

export function isTInnerCommonError(x: any): x is TInnerCommonError {
    return x instanceof CancellationError || x instanceof InvariantError || x instanceof UnknownError;
}

export function ensureCommonError(templates: ILocalizationTemplates, err: Error): CommonError {
    if (err instanceof CommonError) {
        return err;
    } else if (isTInnerCommonError(err)) {
        return new CommonError(err);
    } else {
        return new CommonError(new UnknownError(templates, err));
    }
}
