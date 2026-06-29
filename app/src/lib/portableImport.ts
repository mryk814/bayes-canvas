import {
  isPortablePackageImportCandidate as isPortableInputCandidate,
  previewPortablePackageImport as previewPortableInputPackage,
  type PortablePackageImportPreview,
} from './canvasProjector.js';

export type { PortablePackageImportPreview };

export function isPortablePackageImportCandidate(value: unknown): boolean {
  return isPortableInputCandidate(value);
}

export function previewPortablePackageImport(packageData: unknown): PortablePackageImportPreview {
  return previewPortableInputPackage(packageData);
}
