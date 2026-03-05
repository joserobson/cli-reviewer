import type { ProjectConfig, ProjectType } from './types';

const VALID_TYPES: ProjectType[] = ['front', 'api', 'generic'];

/**
 * Reads project configuration from environment variables.
 *
 * Preferred format (supports any number of projects):
 *   GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET,135:generic:Mobile BFF
 *
 * Legacy fallback (still supported for backward compatibility):
 *   GITLAB_PROJECT_ID=133
 *   GITLAB_API_PROJECT_ID=134
 */
export function loadProjects(): ProjectConfig[] {
  const raw = process.env.GITLAB_PROJECTS?.trim();

  if (raw) {
    return parseProjectsEnv(raw);
  }

  // Legacy fallback
  const projects: ProjectConfig[] = [];

  const frontId = process.env.GITLAB_PROJECT_ID?.trim();
  if (frontId) {
    projects.push({ id: frontId, type: 'front', label: 'Frontend Angular' });
  }

  const apiId = process.env.GITLAB_API_PROJECT_ID?.trim();
  if (apiId) {
    projects.push({ id: apiId, type: 'api', label: 'API .NET' });
  }

  return projects;
}

function parseProjectsEnv(raw: string): ProjectConfig[] {
  const projects: ProjectConfig[] = [];

  for (const entry of raw.split(',')) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    const parts = trimmed.split(':');
    if (parts.length < 2) {
      console.warn(`[projects] Skipping invalid entry (expected id:type or id:type:label): "${trimmed}"`);
      continue;
    }

    const [id, rawType, ...labelParts] = parts;
    const type = rawType as ProjectType;

    if (!VALID_TYPES.includes(type)) {
      console.warn(`[projects] Unknown type "${rawType}" for project "${id}". Valid types: ${VALID_TYPES.join(', ')}`);
      continue;
    }

    const label = labelParts.join(':').trim() || `Project ${id}`;
    projects.push({ id: id.trim(), type, label });
  }

  return projects;
}
