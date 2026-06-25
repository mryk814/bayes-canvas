import { modelTemplates } from './modelTemplates.js';

export interface CorpusEntry {
  id: string;
  title: string;
  expectedMaxErrors: number;
  templateId: string;
}

export const modelCorpus: CorpusEntry[] = modelTemplates.map((template) => ({
  id: `valid_${template.id}`,
  title: template.name,
  expectedMaxErrors: 4,
  templateId: template.id,
}));
