export interface ImplementationReceipt {
  receiptVersion: '1.0.0';
  inputSpecificationFingerprint: string;
  backend: string;
  mappings: Array<{
    entityId: string;
    implementationSymbol: string;
    file: string;
    lineRange?: [number, number];
  }>;
  deviations: string[];
  addedAssumptions: string[];
  approximations: string[];
  unresolvedQuestions: string[];
}

export function validateImplementationReceipt(value: unknown): ImplementationReceipt {
  if (!value || typeof value !== 'object') throw new Error('Receipt must be a JSON object.');
  const receipt = value as Partial<ImplementationReceipt>;
  if (receipt.receiptVersion !== '1.0.0') throw new Error('Unsupported receipt version.');
  if (!receipt.inputSpecificationFingerprint) throw new Error('Receipt is missing inputSpecificationFingerprint.');
  if (!receipt.backend) throw new Error('Receipt is missing backend.');
  if (!Array.isArray(receipt.mappings)) throw new Error('Receipt mappings must be an array.');
  for (const [index, mapping] of receipt.mappings.entries()) {
    if (!mapping.entityId || !mapping.implementationSymbol || !mapping.file) {
      throw new Error(`Receipt mapping ${index} is missing entityId, implementationSymbol, or file.`);
    }
  }
  return {
    receiptVersion: '1.0.0',
    inputSpecificationFingerprint: receipt.inputSpecificationFingerprint,
    backend: receipt.backend,
    mappings: receipt.mappings,
    deviations: receipt.deviations ?? [],
    addedAssumptions: receipt.addedAssumptions ?? [],
    approximations: receipt.approximations ?? [],
    unresolvedQuestions: receipt.unresolvedQuestions ?? [],
  };
}
