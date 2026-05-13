const express = require('express');
const request = require('supertest');

const app = express();
app.get('/health', (_req, res) => res.status(200).json({ status: 'ok' }));

describe('Health API Check', () => {
  it('GET /health should return 200 and status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.statusCode).toEqual(200);
    expect(res.body.status).toEqual('ok');
  });
});
