import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { loadProjects } from '../src/projects';

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const original: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    original[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

describe('loadProjects — formato GITLAB_PROJECTS', () => {
  it('carrega um único projeto front', () => {
    withEnv({ GITLAB_PROJECTS: '133:front:Frontend Angular', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0].id, '133');
      assert.equal(projects[0].type, 'front');
      assert.equal(projects[0].label, 'Frontend Angular');
    });
  });

  it('carrega dois projetos (front + api)', () => {
    withEnv({ GITLAB_PROJECTS: '133:front:Frontend,134:api:API .NET', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 2);
      assert.equal(projects[0].type, 'front');
      assert.equal(projects[1].type, 'api');
      assert.equal(projects[1].label, 'API .NET');
    });
  });

  it('carrega projeto do tipo generic', () => {
    withEnv({ GITLAB_PROJECTS: '135:generic:Mobile BFF', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0].type, 'generic');
    });
  });

  it('usa label padrão quando não informado', () => {
    withEnv({ GITLAB_PROJECTS: '133:front', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0].label, 'Project 133');
    });
  });

  it('ignora entradas com tipo inválido', () => {
    withEnv({ GITLAB_PROJECTS: '133:react:Frontend,134:api:API', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1); // 'react' é inválido, só 'api' entra
      assert.equal(projects[0].type, 'api');
    });
  });

  it('ignora entradas malformadas (sem ":")', () => {
    withEnv({ GITLAB_PROJECTS: 'somente-isso,134:api:API', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1);
    });
  });

  it('retorna lista vazia se GITLAB_PROJECTS está vazio', () => {
    withEnv({ GITLAB_PROJECTS: '', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 0);
    });
  });

  it('aceita ID baseado em caminho (group/project)', () => {
    withEnv({ GITLAB_PROJECTS: 'grupo/projeto:front:App', GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects[0].id, 'grupo/projeto');
    });
  });
});

describe('loadProjects — fallback legacy (GITLAB_PROJECT_ID + GITLAB_API_PROJECT_ID)', () => {
  it('carrega projeto front via env legado', () => {
    withEnv({ GITLAB_PROJECTS: undefined, GITLAB_PROJECT_ID: '133', GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0].id, '133');
      assert.equal(projects[0].type, 'front');
    });
  });

  it('carrega dois projetos via env legado', () => {
    withEnv({ GITLAB_PROJECTS: undefined, GITLAB_PROJECT_ID: '133', GITLAB_API_PROJECT_ID: '134' }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 2);
      assert.equal(projects[0].type, 'front');
      assert.equal(projects[1].type, 'api');
    });
  });

  it('retorna lista vazia se nenhum env definido', () => {
    withEnv({ GITLAB_PROJECTS: undefined, GITLAB_PROJECT_ID: undefined, GITLAB_API_PROJECT_ID: undefined }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 0);
    });
  });

  it('GITLAB_PROJECTS tem prioridade sobre env legado', () => {
    withEnv({ GITLAB_PROJECTS: '135:generic:App', GITLAB_PROJECT_ID: '133', GITLAB_API_PROJECT_ID: '134' }, () => {
      const projects = loadProjects();
      assert.equal(projects.length, 1);
      assert.equal(projects[0].id, '135');
    });
  });
});
