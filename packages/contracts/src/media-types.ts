export interface ParsedMediaTypeParameter {
  readonly name: string;
  readonly value: string;
}

export interface ParsedMediaType {
  readonly raw: string;
  readonly essence: string;
  readonly parameters: readonly ParsedMediaTypeParameter[];
}

export interface StorageObjectMimeComparison {
  readonly sourceContentType: string;
  readonly destinationContentType: string;
  readonly sourceSha256: string;
  readonly destinationSha256: string;
  readonly sourceSize: number;
  readonly destinationSize: number;
}

const TOKEN_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/** Parses a syntactically valid HTTP media type without trusting its contents. */
export function parseMediaType(raw: string): ParsedMediaType | null {
  const parts = splitMediaType(raw.replace(/^[ \t]+|[ \t]+$/g, ''));
  if (!parts || parts.length === 0) {
    return null;
  }

  const essence = parts[0];
  if (!essence) {
    return null;
  }
  const parameterParts = parts.slice(1);
  const slashIndex = essence.indexOf('/');
  if (slashIndex <= 0 || slashIndex !== essence.lastIndexOf('/')) {
    return null;
  }

  const type = essence.slice(0, slashIndex);
  const subtype = essence.slice(slashIndex + 1);
  if (
    !TOKEN_PATTERN.test(type) ||
    !TOKEN_PATTERN.test(subtype) ||
    type.includes('*') ||
    subtype.includes('*')
  ) {
    return null;
  }

  const parameters: ParsedMediaTypeParameter[] = [];
  for (const part of parameterParts) {
    const parameter = parseParameter(part);
    if (!parameter || parameters.some(({ name }) => name === parameter.name)) {
      return null;
    }
    parameters.push(parameter);
  }

  return {
    raw,
    essence: `${type.toLowerCase()}/${subtype.toLowerCase()}`,
    parameters,
  };
}

/** Applies BuildingOS's narrow parameter policy to an allowed media type. */
export function isAllowedMediaType(
  raw: string,
  allowedMediaTypes: ReadonlySet<string>,
): boolean {
  const parsed = parseMediaType(raw);
  if (!parsed || !allowedMediaTypes.has(parsed.essence)) {
    return false;
  }

  if (parsed.parameters.length === 0) {
    return true;
  }

  return parsed.essence === 'text/plain' &&
    parsed.parameters.length === 1 &&
    parsed.parameters[0]?.name === 'charset' &&
    parsed.parameters[0]?.value.toLowerCase() === 'utf-8';
}

/**
 * Compares storage metadata only after the byte-level invariants match.
 * The sole non-exact MIME exception is a provider-added UTF-8 charset for
 * a source `text/plain` object.
 */
export function isStorageObjectMimeCompatible(
  comparison: StorageObjectMimeComparison,
): boolean {
  if (
    comparison.sourceSha256 !== comparison.destinationSha256 ||
    comparison.sourceSize !== comparison.destinationSize
  ) {
    return false;
  }

  const source = parseMediaType(comparison.sourceContentType);
  const destination = parseMediaType(comparison.destinationContentType);
  if (!source || !destination) {
    return false;
  }

  if (source.raw.trim() === destination.raw.trim()) {
    return true;
  }

  return source.essence === 'text/plain' &&
    destination.essence === 'text/plain' &&
    source.parameters.length === 0 &&
    destination.parameters.length === 1 &&
    destination.parameters[0]?.name === 'charset' &&
    destination.parameters[0]?.value.toLowerCase() === 'utf-8';
}

function splitMediaType(value: string): string[] | null {
  if (!value) {
    return null;
  }

  const parts: string[] = [];
  let current = '';
  let quoted = false;
  let escaped = false;

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (quoted && character === '\\') {
      current += character;
      escaped = true;
      continue;
    }
    if (character === '"') {
      quoted = !quoted;
      current += character;
      continue;
    }
    if (!quoted && character === ';') {
      if (!current.trim()) {
        return null;
      }
      parts.push(current.trim());
      current = '';
      continue;
    }
    if (character === '\r' || character === '\n') {
      return null;
    }
    current += character;
  }

  if (quoted || escaped || !current.trim()) {
    return null;
  }
  parts.push(current.trim());
  return parts;
}

function parseParameter(value: string): ParsedMediaTypeParameter | null {
  const equalsIndex = value.indexOf('=');
  if (equalsIndex <= 0) {
    return null;
  }

  const name = value.slice(0, equalsIndex).trim();
  const parsedValue = parseParameterValue(value.slice(equalsIndex + 1).trim());
  if (!TOKEN_PATTERN.test(name) || parsedValue === null) {
    return null;
  }

  return { name: name.toLowerCase(), value: parsedValue };
}

function parseParameterValue(value: string): string | null {
  if (TOKEN_PATTERN.test(value)) {
    return value;
  }
  if (value.length < 2 || value[0] !== '"' || value[value.length - 1] !== '"') {
    return null;
  }

  let result = '';
  let escaped = false;
  for (const character of value.slice(1, -1)) {
    if (escaped) {
      result += character;
      escaped = false;
      continue;
    }
    if (character === '\\') {
      escaped = true;
      continue;
    }
    if (character === '"' || character === '\r' || character === '\n') {
      return null;
    }
    result += character;
  }

  return escaped || !result ? null : result;
}
