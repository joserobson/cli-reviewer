export type ProjectType = 'front' | 'api' | 'generic';

export interface ProjectConfig {
  id: string;
  type: ProjectType;
  label: string;
}

export interface MergeRequest {
  iid: number;
  id: number;
  title: string;
  description: string | null;
  author: { name: string; username: string };
  source_branch: string;
  target_branch: string;
  created_at: string;
  updated_at: string;
  web_url: string;
  changes_count: string;
  state: string;
  draft: boolean;
}

export interface FileChange {
  old_path: string;
  new_path: string;
  diff: string;
  new_file: boolean;
  deleted_file: boolean;
  renamed_file: boolean;
}

export interface MergeRequestDetail extends MergeRequest {
  changes: FileChange[];
  diff_refs: {
    base_sha: string;
    head_sha: string;
    start_sha: string;
  };
}

export interface Suggestion {
  arquivo: string;
  comentario: string;
  severidade: 'critico' | 'aviso' | 'sugestao';
}

export interface ClaudeAnalysis {
  resumo: string;
  aprovacao_recomendada: boolean;
  riscos: string[];
  sugestoes: Suggestion[];
  comentario_geral: string;
}

export type MRAnalysisResult =
  | { status: 'fulfilled'; mr: MergeRequest; analysis: ClaudeAnalysis }
  | { status: 'rejected';  mr: MergeRequest; error: string };
