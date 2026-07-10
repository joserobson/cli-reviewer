import type { ProjectConfig, ProjectPlatform, ProjectType } from './types';

const VALID_TYPES: ProjectType[] = ['front', 'api', 'generic'];

/**
 * Reads project configuration from environment variables.
 *
 * Preferred GitLab format (supports any number of projects):
 *   GITLAB_PROJECTS=133:front:Frontend Angular,134:api:API .NET,135:generic:Mobile BFF
 *
 * GitHub format:
 *   GITHUB_REPOSITORIES=owner/repo:generic:CLI Reviewer,org/api:api:Backend
 *
 * Legacy fallback (still supported for backward compatibility):
 *   GITLAB_PROJECT_ID=133
 *   GITLAB_API_PROJECT_ID=134
 */
export function loadProjects(): ProjectConfig[] {
  const projects: ProjectConfig[] = [];
  const rawGitLab = process.env.GITLAB_PROJECTS?.trim();
  const rawGitHub = process.env.GITHUB_REPOSITORIES?.trim();

  if (rawGitLab) {
    projects.push(...parseProjectsEnv(rawGitLab, 'gitlab'));
  }

  if (rawGitHub) {
    projects.push(...parseProjectsEnv(rawGitHub, 'github'));
  }

  if (projects.length > 0) return projects;

  const frontId = process.env.GITLAB_PROJECT_ID?.trim();
  if (frontId) {
    projects.push({ id: frontId, type: 'front', label: 'Frontend Angular', platform: 'gitlab' });
  }

  const apiId = process.env.GITLAB_API_PROJECT_ID?.trim();
  if (apiId) {
    projects.push({ id: apiId, type: 'api', label: 'API .NET', platform: 'gitlab' });
  }

  return projects;
}

function parseProjectsEnv(raw: string, platform: ProjectPlatform): ProjectConfig[] {
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
    projects.push({ id: id.trim(), type, label, platform });
  }

  return projects;
}
