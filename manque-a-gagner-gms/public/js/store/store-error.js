// Error shared by both stores, shaped like the API's JSON errors.

export class StoreError extends Error {
  constructor(message, { status = 400, fields, rows, references, code } = {}) {
    super(message);
    this.status = status;
    this.fields = fields;
    this.rows = rows;
    this.references = references;
    this.code = code;
  }
}
