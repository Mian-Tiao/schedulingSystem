import type { Product, Machine, ChangeoverRule, BomItem, Downtime } from '../types';

// 初始化種子資料
const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod-a',
    productCode: 'P-A',
    productName: '塑膠外殼',
    description: '射出成型塑膠外殼',
    defaultProcessingTime: 5,
    defaultCleaningTime: 10,
  },
  {
    id: 'prod-b',
    productCode: 'P-B',
    productName: '金屬支架',
    description: '沖壓金屬支架',
    defaultProcessingTime: 8,
    defaultCleaningTime: 15,
  },
  {
    id: 'prod-c',
    productCode: 'P-C',
    productName: '電路板',
    description: 'SMT 電路板',
    defaultProcessingTime: 12,
    defaultCleaningTime: 20,
  },
];

const INITIAL_MACHINES: Machine[] = [
  {
    id: 'mach-1',
    machineCode: 'M-01',
    machineName: '一號射出機',
    model: 'IJ-2000',
    description: '專用塑膠外殼射出機',
    supportedProductIds: ['prod-a', 'prod-b'],
    defaultSetupTime: 20,
    defaultCleaningTime: 10,
    workingHours: {
      mon: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      tue: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      wed: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      thu: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      fri: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      sat: [],
      sun: [],
    },
    status: 'available',
    downtimes: [
      {
        id: 'dt-1',
        machineId: 'mach-1',
        type: 'maintenance',
        startTime: new Date(Date.now() + 86400000).toISOString(), // 明天
        endTime: new Date(Date.now() + 86400000 + 10800000).toISOString(), // 維護3小時
        reason: '每月定期保養',
      },
    ],
  },
  {
    id: 'mach-2',
    machineCode: 'M-02',
    machineName: '二號多功能機',
    model: 'MF-500',
    description: '可加工全部產品類型',
    supportedProductIds: ['prod-a', 'prod-b', 'prod-c'],
    defaultSetupTime: 25,
    defaultCleaningTime: 15,
    workingHours: {
      mon: [{ start: '08:00', end: '17:00' }],
      tue: [{ start: '08:00', end: '17:00' }],
      wed: [{ start: '08:00', end: '17:00' }],
      thu: [{ start: '08:00', end: '17:00' }],
      fri: [{ start: '08:00', end: '17:00' }],
      sat: [{ start: '08:00', end: '12:00' }],
      sun: [],
    },
    status: 'available',
    downtimes: [],
  },
  {
    id: 'mach-3',
    machineCode: 'M-03',
    machineName: '三號 SMT 線',
    model: 'SMT-8',
    description: '高精密度電路板貼片線',
    supportedProductIds: ['prod-c'],
    defaultSetupTime: 30,
    defaultCleaningTime: 20,
    workingHours: {
      mon: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      tue: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      wed: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      thu: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      fri: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '17:00' }],
      sat: [],
      sun: [],
    },
    status: 'available',
    downtimes: [],
  },
];

const INITIAL_CHANGEOVER_RULES: ChangeoverRule[] = [
  {
    id: 'rule-1',
    machineId: 'mach-1',
    fromProductId: 'prod-a',
    toProductId: 'prod-b',
    setupMinutes: 30,
    cleaningMinutes: 20,
  },
  {
    id: 'rule-2',
    machineId: 'mach-1',
    fromProductId: 'prod-b',
    toProductId: 'prod-a',
    setupMinutes: 15,
    cleaningMinutes: 10,
  },
  {
    id: 'rule-3',
    machineId: 'mach-2',
    fromProductId: 'prod-b',
    toProductId: 'prod-c',
    setupMinutes: 40,
    cleaningMinutes: 25,
  },
  {
    id: 'rule-4',
    machineId: null,
    fromProductId: 'prod-a',
    toProductId: 'prod-c',
    setupMinutes: 35,
    cleaningMinutes: 20,
  },
];

const INITIAL_BOM_ITEMS: BomItem[] = [
  {
    id: 'bom-1',
    productId: 'prod-a',
    materialName: '塑膠粒 (ABS)',
    unit: '公斤',
    quantity: 0.12,
    customFields: { 規格: '防火級', 供應商: '奇美實業' },
  },
  {
    id: 'bom-2',
    productId: 'prod-a',
    materialName: '包裝紙盒',
    unit: '個',
    quantity: 1,
    customFields: { 規格: '單色印刷', 供應商: '榮成紙業' },
  },
  {
    id: 'bom-3',
    productId: 'prod-b',
    materialName: '不鏽鋼板 (SUS304)',
    unit: '公斤',
    quantity: 0.25,
    customFields: { 規格: '厚度 1.5mm', 供應商: '樺聯鋼鐵' },
  },
];

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

// 模擬 API 路由器攔截器
export function tryMockRequest(method: string, url: string, reqBody?: any): { handled: boolean; data?: any } {
  // 檢查是否啟用 Mock 功能
  if (localStorage.getItem('USE_MOCK') === 'false') {
    return { handled: false };
  }

  const body = reqBody || {};

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
        productCode: body.productCode,
        productName: body.productName,
        description: body.description ?? null,
        defaultProcessingTime: body.defaultProcessingTime,
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
          materialName: body.materialName,
          unit: body.unit,
          quantity: body.quantity,
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
        list[idx] = { ...list[idx], ...body };
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
        machineCode: body.machineCode,
        machineName: body.machineName,
        model: body.model ?? null,
        description: body.description ?? null,
        supportedProductIds: body.supportedProductIds ?? [],
        defaultSetupTime: body.defaultSetupTime ?? 0,
        defaultCleaningTime: body.defaultCleaningTime ?? 0,
        workingHours: body.workingHours,
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
          type: body.type,
          startTime: body.startTime,
          endTime: body.endTime,
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
        toProductId: body.toProductId,
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
