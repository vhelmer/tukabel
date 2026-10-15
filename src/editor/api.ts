import type { GameContent } from '../game/types';

export interface ProjectResponse {
  content: GameContent;
  revision: string;
  assets: string[];
}
async function request<T>(
  url: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/__tukabel/editor/${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Tukabel-Editor': '1' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error([data.error, ...(data.errors ?? [])].join('\n'));
  return data as T;
}
export const readProject = () => request<ProjectResponse>('project');
export const writeProject = (content: GameContent, revision: string) =>
  request<{ revision: string }>('project', 'PUT', { content, revision });
export async function importAsset(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.length > 6 * 1024 * 1024)
    throw new Error('Obrázok môže mať najviac 6 MB.');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return request<{ id: string; assets: string[] }>('assets', 'POST', {
    name: file.name,
    data: btoa(binary),
  });
}

export const animationServiceInfo = () =>
  request<import('./animationTypes').AnimationServiceInfo>('animations/info');
export const animationSourceInfo = (id: string) =>
  request<import('./animationTypes').SourceInfo>(
    `animations/source?id=${encodeURIComponent(id)}`,
  );
export const animationJobs = () =>
  request<import('./animationTypes').AnimationJob[]>('animations/jobs');
export const startAnimationJob = (
  input: import('./animationTypes').GenerationRequest,
) =>
  request<import('./animationTypes').AnimationJob>(
    'animations/jobs',
    'POST',
    input,
  );
export const readAnimationJob = (id: string) =>
  request<{ job: import('./animationTypes').AnimationJob; assets: string[] }>(
    `animations/jobs/${id}`,
  );
export const cancelAnimationJob = (id: string) =>
  request<import('./animationTypes').AnimationJob>(
    `animations/jobs/${id}`,
    'DELETE',
  );

export const saveAnimationVideo = (
  id: string,
  processing: import('./animationTypes').VideoProcessing,
) =>
  request<{
    animation: import('../game/types').AnimationDefinition;
    assets: string[];
  }>(`animations/jobs/${id}/save`, 'POST', processing);
