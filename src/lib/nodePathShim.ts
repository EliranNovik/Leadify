export function resolve(...segments: string[]): string {
  return segments
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/');
}

export function isAbsolute(filePath: string): boolean {
  return filePath.startsWith('/');
}

export default { resolve, isAbsolute };
