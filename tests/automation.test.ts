import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { getAutoReviewConfig, shouldSkipMergeRequest } from '../src/automation';
import type { MergeRequest } from '../src/types';

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

function makeMr(draft: boolean): MergeRequest {
  return {
    iid: 1,
    id: 100,
    title: 'MR',
    description: null,
    author: { name: 'Dev', username: 'dev' },
    source_branch: 'feature/test',
    target_branch: 'main',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    web_url: 'https://gitlab.example.com/mr/1',
    changes_count: '1',
    state: 'opened',
    draft,
  };
}

describe('getAutoReviewConfig', () => {
  it('usa padroes seguros', () => {
    withEnv({
      AUTO_REVIEW_ENABLED: undefined,
      AUTO_REVIEW_MODE: undefined,
      AUTO_REVIEW_APPROVE_ON_SUCCESS: undefined,
      AUTO_REVIEW_MERGE_ON_SUCCESS: undefined,
    }, () => {
      const config = getAutoReviewConfig();
      assert.equal(config.enabled, false);
      assert.equal(config.mode, 'polling');
      assert.equal(config.postComment, true);
      assert.equal(config.skipDraft, true);
      assert.equal(config.approveOnSuccess, false);
      assert.equal(config.mergeOnSuccess, false);
    });
  });

  it('le modo webhook e flags booleanas', () => {
    withEnv({
      AUTO_REVIEW_ENABLED: 'true',
      AUTO_REVIEW_MODE: 'webhook',
      AUTO_REVIEW_POST_COMMENT: 'false',
      AUTO_REVIEW_NOTIFY_DESKTOP: 'false',
      AUTO_REVIEW_SKIP_DRAFT: 'false',
      AUTO_REVIEW_APPROVE_ON_SUCCESS: 'true',
      AUTO_REVIEW_MERGE_ON_SUCCESS: 'true',
    }, () => {
      const config = getAutoReviewConfig();
      assert.equal(config.enabled, true);
      assert.equal(config.mode, 'webhook');
      assert.equal(config.postComment, false);
      assert.equal(config.notifyDesktop, false);
      assert.equal(config.skipDraft, false);
      assert.equal(config.approveOnSuccess, true);
      assert.equal(config.mergeOnSuccess, true);
    });
  });
});

describe('shouldSkipMergeRequest', () => {
  it('ignora draft quando configurado', () => {
    assert.equal(
      shouldSkipMergeRequest(makeMr(true), { ...getAutoReviewConfig(), skipDraft: true }),
      'draft MR',
    );
  });

  it('nao ignora draft quando permitido', () => {
    assert.equal(
      shouldSkipMergeRequest(makeMr(true), { ...getAutoReviewConfig(), skipDraft: false }),
      null,
    );
  });
});
