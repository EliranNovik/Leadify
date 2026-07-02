export function pathToFileURL(filePath: string): URL {
  const normalized = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return new URL(`file://${normalized}`);
}

export function fileURLToPath(url: string | URL): string {
  const href = typeof url === 'string' ? url : url.href;
  return href.replace(/^file:\/\//, '');
}

export default { pathToFileURL, fileURLToPath };
