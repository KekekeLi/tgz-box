import axios, { AxiosInstance, AxiosRequestConfig } from 'axios';
import { Agent } from 'http';
import { Agent as HttpsAgent } from 'https';

// 信号量类，用于控制并发
class Semaphore {
  private permits: number;
  private waitQueue: Array<() => void> = [];

  constructor(permits: number) {
    this.permits = permits;
  }

  async acquire(): Promise<() => void> {
    return new Promise((resolve) => {
      if (this.permits > 0) {
        this.permits--;
        // 添加微小延迟，避免瞬间大量请求
        setTimeout(() => resolve(() => this.release()), Math.random() * 10);
      } else {
        this.waitQueue.push(() => {
          this.permits--;
          setTimeout(() => resolve(() => this.release()), Math.random() * 10);
        });
      }
    });
  }

  private release(): void {
    this.permits++;
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      next();
    }
  }
}

/**
 * 网络请求优化器
 * 提供连接池、keepAlive、智能重试、网络自适应等优化功能
 */
export class NetworkOptimizer {
  private axiosInstance: AxiosInstance;
  private requestCache = new Map<string, { data: any; timestamp: number }>();
  private readonly cacheTimeout = 5 * 60 * 1000; // 5分钟缓存
  
  // 网络自适应相关
  private networkSpeed: 'slow' | 'medium' | 'fast' = 'medium';
  private requestTimes: number[] = [];
  private errorCount = 0;
  private totalRequests = 0;
  
  // 断路器相关
  private circuitBreakerOpen = false;
  private circuitBreakerOpenTime = 0;
  private readonly circuitBreakerTimeout = 60000; // 1分钟后尝试恢复
  private readonly errorThreshold = 0.5; // 错误率超过50%时开启断路器
  
  constructor() {
    // 创建HTTP/HTTPS代理，启用连接池和keepAlive
    const httpAgent = new Agent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 30, // 减少最大连接数，避免过载
      maxFreeSockets: 5,
      timeout: 30000 // 增加socket超时时间
    });
    
    const httpsAgent = new HttpsAgent({
      keepAlive: true,
      keepAliveMsecs: 30000,
      maxSockets: 30, // 减少最大连接数，避免过载
      maxFreeSockets: 5,
      timeout: 30000 // 增加socket超时时间
    });
    
    // 创建优化的axios实例
    this.axiosInstance = axios.create({
      timeout: 30000, // 增加超时时间到30秒
      httpAgent,
      httpsAgent,
      headers: {
        'User-Agent': 'tgz-box-optimized/1.0.0',
        'Accept': 'application/json',
        'Accept-Encoding': 'gzip, deflate',
        'Connection': 'keep-alive'
      },
      // 启用压缩
      decompress: true,
      // 最大重定向次数
      maxRedirects: 5
    });
    
    // 添加请求拦截器
    this.axiosInstance.interceptors.request.use(
      (config) => {
        // 添加请求时间戳
        config.metadata = { startTime: Date.now() };
        return config;
      },
      (error) => Promise.reject(error)
    );
    
    // 添加响应拦截器
    this.axiosInstance.interceptors.response.use(
      (response) => {
        // 记录成功请求的时间
        const endTime = Date.now();
        const duration = endTime - (response.config?.metadata?.startTime || endTime);
        this.updateNetworkMetrics(duration, false);
        return response;
      },
      (error) => {
        // 记录失败请求
        const endTime = Date.now();
        const duration = endTime - (error.config?.metadata?.startTime || endTime);
        this.updateNetworkMetrics(duration, true);
        console.debug(`请求失败: ${error.config?.url} 耗时 ${duration}ms, 错误: ${error.message}`);
        return Promise.reject(error);
      }
    );
  }
  
  /**
   * 带缓存的GET请求
   */
  async get(url: string, config?: AxiosRequestConfig): Promise<any> {
    // 检查断路器状态
    if (this.circuitBreakerOpen) {
      // 检查是否可以尝试恢复
      if (Date.now() - this.circuitBreakerOpenTime > this.circuitBreakerTimeout) {
        this.circuitBreakerOpen = false;
        console.log('🔄 尝试恢复网络连接...');
      } else {
        throw new Error('网络断路器开启中，请稍后重试');
      }
    }
    
    // 检查缓存
    const cached = this.getFromCache(url);
    if (cached) {
      return cached;
    }
    
    try {
      const response = await this.axiosInstance.get(url, config);
      // 缓存成功的响应
      this.setCache(url, response.data);
      return response.data;
    } catch (error) {
      throw error;
    }
  }
  
  /**
   * 带智能重试的GET请求
   */
  async getWithRetry(url: string, config?: AxiosRequestConfig, maxRetries = 5): Promise<any> {
    let lastError: any;
    
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.get(url, config);
      } catch (error: any) {
        lastError = error;
        
        // 如果是最后一次尝试，直接抛出错误
        if (attempt === maxRetries) {
          break;
        }
        
        // 根据错误类型决定是否重试
        if (this.shouldRetry(error)) {
          const delay = this.calculateRetryDelay(attempt);
          await this.sleep(delay);
          continue;
        } else {
          // 不应该重试的错误直接抛出
          break;
        }
      }
    }
    
    throw lastError;
  }
  
  /**
   * 网络速度检测和自适应并发控制
   */
  private updateNetworkMetrics(requestTime: number, hasError: boolean): void {
    this.totalRequests++;
    if (hasError) {
      this.errorCount++;
    }
    
    this.requestTimes.push(requestTime);
    // 只保留最近100次请求的数据
    if (this.requestTimes.length > 100) {
      this.requestTimes.shift();
    }
    
    // 每20次请求重新评估网络速度
    if (this.totalRequests % 20 === 0) {
      this.assessNetworkSpeed();
    }
  }
  
  private assessNetworkSpeed(): void {
    if (this.requestTimes.length < 10) return;
    
    const avgTime = this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length;
    const errorRate = this.errorCount / this.totalRequests;
    
    // 检查是否需要开启断路器
    if (errorRate > this.errorThreshold && this.totalRequests > 20) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerOpenTime = Date.now();
      console.log(`⚠️  网络状况不佳，开启断路器模式 (错误率: ${(errorRate * 100).toFixed(1)}%)`);
    }
    
    // 根据平均响应时间和错误率判断网络速度
    if (avgTime > 5000 || errorRate > 0.3) {
      this.networkSpeed = 'slow';
    } else if (avgTime > 2000 || errorRate > 0.15) {
      this.networkSpeed = 'medium';
    } else {
      this.networkSpeed = 'fast';
    }
  }
  
  private getAdaptiveConcurrency(baseConcurrency: number): number {
    switch (this.networkSpeed) {
      case 'slow':
        return Math.max(3, Math.floor(baseConcurrency * 0.2)); // 更保守的并发数
      case 'medium':
        return Math.max(5, Math.floor(baseConcurrency * 0.5)); // 减少中等网络的并发数
      case 'fast':
        return Math.floor(baseConcurrency * 0.8); // 即使快速网络也适当限制
      default:
        return Math.max(5, Math.floor(baseConcurrency * 0.5)); // 默认保守策略
    }
  }
  
  /**
   * 获取当前网络状态信息
   */
  getNetworkStatus(): { speed: string; concurrency: number; avgTime: number; errorRate: number; circuitBreaker: boolean; totalRequests: number } {
    const avgTime = this.requestTimes.length > 0 
      ? this.requestTimes.reduce((a, b) => a + b, 0) / this.requestTimes.length 
      : 0;
    const errorRate = this.totalRequests > 0 ? this.errorCount / this.totalRequests : 0;
    
    return {
      speed: this.networkSpeed,
      concurrency: this.getAdaptiveConcurrency(30),
      avgTime: Math.round(avgTime),
      errorRate: Math.round(errorRate * 100) / 100,
      circuitBreaker: this.circuitBreakerOpen,
      totalRequests: this.totalRequests
    };
  }
  
  /**
   * 批量并发请求 - 真正的并发控制 + 网络自适应
   */
  async batchGet(urls: string[], concurrency = 30): Promise<Array<{ url: string; data?: any; error?: string }>> {
    // 根据网络状况自适应调整并发数
    let adaptiveConcurrency = this.getAdaptiveConcurrency(concurrency);
    
    // 如果断路器开启，进一步降低并发数
    if (this.circuitBreakerOpen) {
      adaptiveConcurrency = Math.min(adaptiveConcurrency, 2);
      console.log(`🔧 断路器模式下降低并发数至: ${adaptiveConcurrency}`);
    }
    
    const semaphore = new Semaphore(adaptiveConcurrency);
    
    const promises = urls.map(async (url) => {
       const release = await semaphore.acquire();
       const startTime = Date.now();
       try {
         const data = await this.getWithRetry(url);
         const requestTime = Date.now() - startTime;
         this.updateNetworkMetrics(requestTime, false);
         return { url, data };
       } catch (error: any) {
         const requestTime = Date.now() - startTime;
         this.updateNetworkMetrics(requestTime, true);
         return { url, error: error.message || String(error) };
       } finally {
         release();
       }
     });
    
    const results = await Promise.allSettled(promises);
    
    return results.map((result, index) => {
      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return { url: urls[index], error: result.reason };
      }
    });
  }
  
  /**
   * 清理过期缓存
   */
  cleanExpiredCache(): void {
    const now = Date.now();
    for (const [key, value] of this.requestCache.entries()) {
      if (now - value.timestamp > this.cacheTimeout) {
        this.requestCache.delete(key);
      }
    }
  }
  
  /**
   * 获取缓存统计信息
   */
  getCacheStats(): { size: number; hitRate: number } {
    return {
      size: this.requestCache.size,
      hitRate: 0 // 简化实现，实际可以统计命中率
    };
  }
  
  private getFromCache(url: string): any | null {
    const cached = this.requestCache.get(url);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }
  
  private setCache(url: string, data: any): void {
    this.requestCache.set(url, {
      data,
      timestamp: Date.now()
    });
    
    // 定期清理缓存
    if (this.requestCache.size % 100 === 0) {
      this.cleanExpiredCache();
    }
  }
  
  private shouldRetry(error: any): boolean {
    // 网络错误、超时错误、DNS错误等可以重试
    if (error.code === 'ECONNRESET' || 
        error.code === 'ETIMEDOUT' || 
        error.code === 'ENOTFOUND' ||
        error.code === 'ECONNREFUSED' ||
        error.code === 'EHOSTUNREACH' ||
        error.code === 'ENETUNREACH' ||
        error.code === 'EAI_AGAIN' ||
        error.code === 'EPIPE' ||
        error.code === 'ECONNABORTED') {
      return true;
    }
    
    // axios超时错误
    if (error.code === 'ECONNABORTED' && error.message.includes('timeout')) {
      return true;
    }
    
    if (error.response) {
      const status = error.response.status;
      // 5xx服务器错误、429限流、502/503/504网关错误可以重试
      return status >= 500 || status === 429 || status === 502 || status === 503 || status === 504;
    }
    
    return false;
  }
  
  private calculateRetryDelay(attempt: number): number {
    // 根据网络状况调整退避策略
    let baseDelay = 1000; // 1秒
    const maxDelay = 15000; // 15秒
    
    // 根据网络速度调整基础延迟
    switch (this.networkSpeed) {
      case 'slow':
        baseDelay = 2000; // 慢网络增加基础延迟
        break;
      case 'medium':
        baseDelay = 1500;
        break;
      case 'fast':
        baseDelay = 1000;
        break;
    }
    
    // 指数退避，但有最大延迟限制
    const delay = Math.min(baseDelay * Math.pow(1.8, attempt), maxDelay);
    
    // 添加随机抖动，避免雷群效应
    const jitter = Math.random() * 0.4 * delay;
    return delay + jitter;
  }
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// 导出单例实例
export const networkOptimizer = new NetworkOptimizer();

// 声明模块扩展
declare module 'axios' {
  interface AxiosRequestConfig {
    metadata?: {
      startTime: number;
    };
  }
}