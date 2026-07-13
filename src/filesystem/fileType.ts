import * as vscode from 'vscode';
import type { BeginningDbKind } from '../beginningdb/types';

export function toVsCodeFileType(kind: BeginningDbKind): vscode.FileType {
  switch (kind) {
    case 'file':
      return vscode.FileType.File;
    case 'dir':
      return vscode.FileType.Directory;
    case 'symlink':
      return vscode.FileType.SymbolicLink;
  }
}
