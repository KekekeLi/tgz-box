type ProgressCallback = (info: {
    current: number;
    total: number;
    pkgName: string;
    version: string;
    percent?: number;
  }) => void;

interface LockData {
    packages: Record<string, any>,
    dependencies: Record<string, any>
  }

interface PackageItem {
    name: string,
    resolved: string,
    path: string,
    v: string
  }