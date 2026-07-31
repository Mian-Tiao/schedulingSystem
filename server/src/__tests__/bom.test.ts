import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app.js';
import { prisma } from '../shared/db.js';

const app = createApp();

let productId: string;
let bomItemId: string;

beforeAll(async () => {
  // Only clean this suite's fixture; other integration tests share the same database.
  await prisma.product.deleteMany({ where: { productCode: 'BOM-TEST-P1' } });

  // Create a test product
  const productRes = await request(app).post('/api/products').send({
    productCode: 'BOM-TEST-P1',
    productName: 'BOM測試產品',
    defaultProcessingTime: 10,
    defaultCleaningTime: 5,
  });
  expect(productRes.status).toBe(201);
  productId = productRes.body.id;
});

afterAll(async () => {
  await prisma.product.deleteMany({ where: { productCode: 'BOM-TEST-P1' } });
  await prisma.$disconnect();
});

describe('BOM API 整合測試', () => {
  it('為產品新增 BOM 項目', async () => {
    const res = await request(app)
      .post(`/api/products/${productId}/bom`)
      .send({
        materialName: '鋼板',
        unit: '公斤',
        quantity: 2.5,
        customFields: {
          規格: '1.2mm',
          供應商: '中鋼',
        },
      });
    expect(res.status).toBe(201);
    expect(res.body.materialName).toBe('鋼板');
    expect(res.body.unit).toBe('公斤');
    expect(res.body.quantity).toBe(2.5);
    expect(res.body.customFields).toEqual({
      規格: '1.2mm',
      供應商: '中鋼',
    });
    bomItemId = res.body.id;
  });

  it('取得該產品的 BOM 列表', async () => {
    const res = await request(app).get(`/api/products/${productId}/bom`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(bomItemId);
    expect(res.body[0].customFields).toEqual({
      規格: '1.2mm',
      供應商: '中鋼',
    });
  });

  it('更新 BOM 項目', async () => {
    const res = await request(app)
      .put(`/api/products/${productId}/bom/${bomItemId}`)
      .send({
        materialName: '鋼板 (優化)',
        unit: '公斤',
        quantity: 2.3,
        customFields: {
          規格: '1.2mm',
          供應商: '中鋼二廠',
          品牌: 'CSC',
        },
      });
    expect(res.status).toBe(200);
    expect(res.body.materialName).toBe('鋼板 (優化)');
    expect(res.body.quantity).toBe(2.3);
    expect(res.body.customFields).toEqual({
      規格: '1.2mm',
      供應商: '中鋼二廠',
      品牌: 'CSC',
    });
  });

  it('驗證錯誤輸入 - 用量為負數', async () => {
    const res = await request(app)
      .post(`/api/products/${productId}/bom`)
      .send({
        materialName: '錯誤項目',
        unit: '個',
        quantity: -1,
        customFields: {},
      });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('刪除 BOM 項目', async () => {
    const delRes = await request(app).delete(`/api/products/${productId}/bom/${bomItemId}`);
    expect(delRes.status).toBe(204);

    const listRes = await request(app).get(`/api/products/${productId}/bom`);
    expect(listRes.status).toBe(200);
    expect(listRes.body.length).toBe(0);
  });

  it('刪除產品時應級聯刪除其 BOM 項目', async () => {
    // 1. 再新增一個 BOM 項目
    const postRes = await request(app)
      .post(`/api/products/${productId}/bom`)
      .send({
        materialName: '螺絲',
        unit: '個',
        quantity: 10,
      });
    expect(postRes.status).toBe(201);
    const newBomId = postRes.body.id;

    // 2. 刪除產品
    const delProductRes = await request(app).delete(`/api/products/${productId}`);
    expect(delProductRes.status).toBe(204);

    // 3. 查詢資料庫，該 BOM 項目應已不存在
    const count = await prisma.bomItem.count({ where: { id: newBomId } });
    expect(count).toBe(0);
  });
});
