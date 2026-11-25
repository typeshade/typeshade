// Implements: Rule 8.21 (docs/language-design.md; traced in reqs/).

const PRIVATE_NAME_PREFIX = 35;

export const shaderField = (key: string): string =>
  key.charCodeAt(0) === PRIVATE_NAME_PREFIX ? key.slice(1) : key;

export const missingField = (key: string): string =>
  key.charCodeAt(0) === PRIVATE_NAME_PREFIX
    ? `the field is missing. ${JSON.stringify(key)} is a private name, which an instance holds and a plain object does not. Build the value with new`
    : 'the field is missing';
