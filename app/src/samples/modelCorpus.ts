import { modelTemplates } from './modelTemplates.js';

export interface CorpusEntry {
  id: string;
  title: string;
  status: 'clean' | 'draft';
  expectedMaxErrors: number;
  expectedMaxWarnings: number;
  templateId: string;
}

export const modelCorpus: CorpusEntry[] = modelTemplates.map((template) => ({
  id: `${template.status}_${template.id}`,
  title: template.name,
  status: template.status,
  expectedMaxErrors: template.expectedDiagnostics.errors,
  expectedMaxWarnings: template.expectedDiagnostics.warnings,
  templateId: template.id,
}));
