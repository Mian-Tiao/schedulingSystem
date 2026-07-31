import type { Product, Machine, ChangeoverRule, BomItem, Downtime } from '../types';
import {
  INITIAL_PRODUCTS,
  INITIAL_MACHINES,
  INITIAL_CHANGEOVER_RULES,
  INITIAL_BOM_ITEMS,
} from './mockData';


// Helper: 讀取/寫入 localStorage
function getStorage<T>(key: string, initial: T): T {
  const data = localStorage.getItem(key);
  if (!data) {
    localStorage.setItem(key, JSON.stringify(initial));
    return initial;
  }
  return JSON.parse(data) as T;
}

function setStorage<T>(key: string, data: T) {
  localStorage.setItem(key, JSON.stringify(data));
}

// 獲取當前數據
const getProducts = () => getStorage('mock_products', INITIAL_PRODUCTS);
const setProducts = (data: Product[]) => setStorage('mock_products', data);

const getMachines = () => getStorage('mock_machines', INITIAL_MACHINES);
const setMachines = (data: Machine[]) => setStorage('mock_machines', data);

const getRules = () => getStorage('mock_changeover_rules', INITIAL_CHANGEOVER_RULES);
const setRules = (data: ChangeoverRule[]) => setStorage('mock_changeover_rules', data);

const getBom = () => getStorage('mock_bom_items', INITIAL_BOM_ITEMS);
const setBom = (data: BomItem[]) => setStorage('mock_bom_items', data);

// 隨機產生 ID
const genId = () => Math.random().toString(36).substring(2, 9);

type MockRequestBody = Partial<Omit<Product, 'id'>> &
  Partial<Omit<Machine, 'id' | 'downtimes'>> &
  Partial<Omit<ChangeoverRule, 'id'>> &
  Partial<Omit<BomItem, 'id' | 'productId'>> &
  Partial<Omit<Downtime, 'id' | 'machineId'>>;

// 模擬 API 路由器攔截器
export function tryMockRequest(method: string, url: string, reqBody?: unknown): { handled: boolean; data?: unknown } {
  // Mock 必須由開發環境明確啟用，避免正式操作只寫入瀏覽器而沒有進資料庫。
  if (import.meta.env.VITE_USE_MOCK !== 'true') {
    return { handled: false };
  }

  const body = (reqBody ?? {}) as MockRequestBody;

  // 1. Products API
  if (url === '/api/products') {
    if (method === 'GET') {
      return { handled: true, data: getProducts() };
    }
    if (method === 'POST') {
      const list = getProducts();
      if (list.some(p => p.productCode === body.productCode)) {
        throw new Error(`產品編號 ${body.productCode} 已存在`);
      }
      const newItem: Product = {
        id: genId(),
        productCode: body.productCode!,
        productName: body.productName!,
        description: body.description ?? null,
        defaultProcessingTime: body.defaultProcessingTime!,
        defaultCleaningTime: body.defaultCleaningTime ?? 0,
      };
      list.push(newItem);
      setProducts(list);
      return { handled: true, data: newItem };
    }
  }

  if (url.startsWith('/api/products/')) {
    const parts = url.split('/');
    // /api/products/:id
    if (parts.length === 4) {
      const id = parts[3];
      const list = getProducts();
      if (method === 'PUT') {
        const idx = list.findIndex(p => p.id === id);
        if (idx === -1) throw new Error('找不到此產品');
        const existing = list[idx] as Product;
        if (body.productCode && body.productCode !== existing.productCode && list.some(p => p.productCode === body.productCode)) {
          throw new Error(`產品編號 ${body.productCode} 已存在`);
        }
        list[idx] = { ...existing, ...body };
        setProducts(list);
        return { handled: true, data: list[idx] };
      }
      if (method === 'DELETE') {
        const filtered = list.filter(p => p.id !== id);
        setProducts(filtered);
        // Cascade delete BOM items
        const boms = getBom().filter(b => b.productId !== id);
        setBom(boms);
        return { handled: true, data: undefined };
      }
    }

    // /api/products/:productId/bom
    if (parts.length === 5 && parts[4] === 'bom') {
      const productId = parts[3] as string;
      if (method === 'GET') {
        const filtered = getBom().filter(b => b.productId === productId);
        return { handled: true, data: filtered };
      }
      if (method === 'POST') {
        const list = getBom();
        const newItem: BomItem = {
          id: genId(),
          productId,
          materialName: body.materialName!,
          unit: body.unit!,
          quantity: body.quantity!,
          customFields: body.customFields ?? {},
        };
        list.push(newItem);
        setBom(list);
        return { handled: true, data: newItem };
      }
    }

    // /api/products/:productId/bom/:id
    if (parts.length === 6 && parts[4] === 'bom') {
      const productId = parts[3] as string;
      const bomId = parts[5];
      const list = getBom();
      if (method === 'PUT') {
        const idx = list.findIndex(b => b.id === bomId && b.productId === productId);
        if (idx === -1) throw new Error('找不到此 BOM 項目');
        const existing = list[idx] as BomItem;
        list[idx] = { ...existing, ...body };
        setBom(list);
        return { handled: true, data: list[idx] };
      }
      if (method === 'DELETE') {
        const filtered = list.filter(b => b.id !== bomId);
        setBom(filtered);
        return { handled: true, data: undefined };
      }
    }
  }

  // 2. Machines API
  if (url === '/api/machines') {
    if (method === 'GET') {
      return { handled: true, data: getMachines() };
    }
    if (method === 'POST') {
      const list = getMachines();
      if (list.some(m => m.machineCode === body.machineCode)) {
        throw new Error(`機台編號 ${body.machineCode} 已存在`);
      }
      const newItem: Machine = {
        id: genId(),
        machineCode: body.machineCode!,
        machineName: body.machineName!,
        model: body.model ?? null,
        description: body.description ?? null,
        supportedProductIds: body.supportedProductIds ?? [],
        defaultSetupTime: body.defaultSetupTime ?? 0,
        defaultCleaningTime: body.defaultCleaningTime ?? 0,
        workingHours: body.workingHours!,
        status: body.status ?? 'available',
        downtimes: [],
      };
      list.push(newItem);
      setMachines(list);
      return { handled: true, data: newItem };
    }
  }

  if (url.startsWith('/api/machines/')) {
    const parts = url.split('/');
    // /api/machines/:id
    if (parts.length === 4) {
      const id = parts[3];
      const list = getMachines();
      if (method === 'PUT') {
        const idx = list.findIndex(m => m.id === id);
        if (idx === -1) throw new Error('找不到此機台');
        const existing = list[idx] as Machine;
        if (body.machineCode && body.machineCode !== existing.machineCode && list.some(m => m.machineCode === body.machineCode)) {
          throw new Error(`機台編號 ${body.machineCode} 已存在`);
        }
        list[idx] = { ...existing, ...body };
        setMachines(list);
        return { handled: true, data: list[idx] };
      }
      if (method === 'DELETE') {
        const filtered = list.filter(m => m.id !== id);
        setMachines(filtered);
        return { handled: true, data: undefined };
      }
    }

    // /api/machines/:id/downtimes
    if (parts.length === 5 && parts[4] === 'downtimes') {
      const machineId = parts[3] as string;
      const list = getMachines();
      const machIdx = list.findIndex(m => m.id === machineId);
      if (machIdx === -1) throw new Error('找不到此機台');
      const mach = list[machIdx] as Machine;

      if (method === 'GET') {
        return { handled: true, data: mach.downtimes ?? [] };
      }
      if (method === 'POST') {
        const dts = mach.downtimes ?? [];
        const newDt: Downtime = {
          id: genId(),
          machineId,
          type: body.type!,
          startTime: body.startTime!,
          endTime: body.endTime!,
          reason: body.reason ?? null,
        };
        dts.push(newDt);
        mach.downtimes = dts;
        setMachines(list);
        return { handled: true, data: newDt };
      }
    }

    // /api/machines/:id/downtimes/:downtimeId
    if (parts.length === 6 && parts[4] === 'downtimes') {
      const machineId = parts[3];
      const downtimeId = parts[5];
      const list = getMachines();
      const machIdx = list.findIndex(m => m.id === machineId);
      if (machIdx === -1) throw new Error('找不到此機台');
      const mach = list[machIdx] as Machine;

      if (method === 'DELETE') {
        const dts = mach.downtimes ?? [];
        mach.downtimes = dts.filter(d => d.id !== downtimeId);
        setMachines(list);
        return { handled: true, data: undefined };
      }
    }
  }

  // 3. Changeover Rules API
  if (url === '/api/changeover-rules') {
    if (method === 'GET') {
      return { handled: true, data: getRules() };
    }
    if (method === 'POST') {
      const list = getRules();
      const newItem: ChangeoverRule = {
        id: genId(),
        machineId: body.machineId ?? null,
        fromProductId: body.fromProductId ?? null,
        toProductId: body.toProductId!,
        setupMinutes: body.setupMinutes ?? 0,
        cleaningMinutes: body.cleaningMinutes ?? 0,
      };
      list.push(newItem);
      setRules(list);
      return { handled: true, data: newItem };
    }
  }

  if (url.startsWith('/api/changeover-rules/')) {
    const parts = url.split('/');
    if (parts.length === 4) {
      const id = parts[3];
      if (method === 'DELETE') {
        const list = getRules();
        const filtered = list.filter(r => r.id !== id);
        setRules(filtered);
        return { handled: true, data: undefined };
      }
    }
  }

  // 其他 API 默認不攔截，以支援排程、AI 與儀表板呼叫真實後端
  return { handled: false };
}
