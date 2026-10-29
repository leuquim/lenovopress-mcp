export class PressError extends Error {
    code;
    details;
    constructor(code, message, details) {
        super(message);
        this.name = "PressError";
        this.code = code;
        this.details = details;
    }
}
export function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=errors.js.map