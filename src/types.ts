export interface PackageItem {
  name: string;
  resolved: string;
  path: string;
  version: string;
}

export interface LockData {
  packages?: Record<string, {
    resolved: string;
    version: string;
  }>;
  dependencies?: Record<string, {
    resolved: string;
    version: string;
    dependencies?: any;
  }>;
}

export interface DownloadProgress {
  total: number;
  completed: number;
  failed: number;
  current?: string;
}

export interface InstallOptions {
  package?: boolean;
  clearCache?: boolean;
  forcePackage?: boolean;
}