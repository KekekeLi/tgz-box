type ProgressCallback = (info: {
    current: number;
    total: number;
    pkgName: string;
    version: string;
    percent?: number;
  }) => void;