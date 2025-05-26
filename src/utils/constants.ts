import path from 'path';

export const PACKAGES_DIR = path.resolve(process.cwd(), 'packages');
export const PACKAGE_JSON_PATH = path.resolve(process.cwd(), 'package.json');
export const PACKAGE_LOCK_PATH = path.resolve(process.cwd(), 'package-lock.json');
export const TEMP_DIR = path.resolve(process.cwd(), '.tgz-box-temp');
export const TEMP_PACKAGE_JSON = path.resolve(TEMP_DIR, 'package.json');
export const TEMP_PACKAGE_LOCK = path.resolve(TEMP_DIR, 'package-lock.json');

export const BASE_PACKAGE_CONTENT = {
  name: 'temp-package',
  version: '1.0.0',
  dependencies: {}
};