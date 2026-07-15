export function createHttpClient() {
  return {
    async get(path: string) {
      const response = await fetch(path, { credentials: 'include' });
      if (!response.ok) {
        throw new Error('Request failed');
      }
      if (response.status === 204) {
        return undefined;
      }
      return response.json();
    },
  };
}
