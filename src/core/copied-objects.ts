let copying = false;

export function copiedObjectsActive(): boolean {
  return copying;
}

export function withCopiedObjects<R>(f: () => R): R {
  const was = copying;
  copying = true;
  try {
    return f();
  } finally {
    copying = was;
  }
}
