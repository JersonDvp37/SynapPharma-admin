const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const postcss = require('postcss');
const root = path.resolve(__dirname, '..');
const cache = new Map();

function compile(source, overrides = {}) {
  const result = { exports: {} };
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const localRequire = (name) => Object.hasOwn(overrides, name) ? overrides[name] : require(name);
  new Function('exports', 'require', 'module', 'console', code)(result.exports, localRequire, result, { log() {}, info() {}, error() {}, groupCollapsed() {}, groupEnd() {} });
  return result.exports;
}

function lib(name) {
  if (!cache.has(name)) cache.set(name, compile(fs.readFileSync(path.join(root, 'src/lib', name + '.ts'), 'utf8')));
  return cache.get(name);
}

const plans = lib('plans');
const inventory = lib('inventory');
const audit = lib('audit');
const sourceText = fs.readFileSync(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
const source = ts.createSourceFile('Dashboard.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const helperNames = ['read', 'amount', 'upper', 'active', 'activeBranch', 'productValidity', 'movementTone', 'notificationTone', 'stockStatus', 'productForMovement', 'isStockLossMovement'];
const helperSource = source.statements.filter((node) => ts.isFunctionDeclaration(node) && helperNames.includes(node.name.text)).map((node) => node.getText(source)).join('\n');
const helperCode = `import { normalizeToken } from 'plans'; import { validityOf } from 'inventory';\n${helperSource}\nexport { ${helperNames.join(', ')} };`;
const helpers = compile(helperCode, { plans, inventory });
const now = new Date('2026-10-25T12:00:00Z');

test('normalization retains plan and movement codes and removes accents correctly', () => {
  for (const code of ['BASIC', 'INTERMEDIATE', 'PREMIUM', 'AVARIA', 'EXPIRACAO', 'FALSE']) assert.equal(plans.normalizeToken(code), code);
  assert.equal(plans.normalizeToken('Expiração'), 'EXPIRACAO');
  assert.equal(plans.normalizePlanCode('Plano Básico'), 'BASIC');
  assert.equal(plans.normalizePlanCode('Intermédio'), 'INTERMEDIATE');
  assert.equal(plans.normalizePlanCode('STANDARD'), 'INTERMEDIATE');
  assert.equal(plans.normalizePlanCode('PRO'), 'PREMIUM');
});

test('plan quotas agree with the desktop and missing quotas never become zero or unlimited', () => {
  const basic = plans.resolvePlan({ plan_type: 'BASIC' }, []);
  assert.equal(basic.pharmacies, 1);
  assert.equal(basic.users, 3);
  const intermediate = plans.resolvePlan({ plan_type: 'INTERMEDIARIO' }, []);
  assert.equal(intermediate.pharmacies, 5);
  assert.equal(intermediate.users, 8);
  const premium = plans.resolvePlan({ plan_type: 'PREMIUM' }, []);
  assert.equal(premium.pharmacies, null);
  assert.equal(premium.users, null);
  assert.equal(plans.resolvePlan({ name: 'Company without a plan' }, []).users, undefined);
  for (const empty of [null, undefined, '', 0]) {
    assert.equal(plans.resolvePlan({ plan_type: 'BASIC' }, [{ code: 'BASIC', max_users: empty }]).users, 3);
  }
});

test('cloud quotas override defaults and plan IDs resolve without using the company name as a plan', () => {
  const records = [{ id: 'plan-a', plan_type: 'BASIC', max_users: 6, max_pharmacies: 2 }];
  assert.equal(plans.resolvePlan({ plan_type: 'BASIC' }, records).users, 6);
  assert.equal(plans.resolvePlan({ name: 'Hill Pharma', plan_id: 'plan-a' }, records).pharmacies, 2);
  assert.equal(plans.resolvePlan({ plan_type: 'PREMIUM' }, [{ code: 'PREMIUM', max_users: 2147483647 }]).users, null);
  assert.equal(plans.limitValue(null), '∞');
  assert.equal(plans.limitValue(undefined), '—');
});

test('audit authors resolve local user IDs within both company and branch, including inactive users', () => {
  const users = [
    { company_id: 'a', pharmacy_id: 'branch-a', local_user_id: 4, nome: 'Ana', ativo: true },
    { company_id: 'a', pharmacy_id: 'branch-b', local_user_id: 4, nome: 'Bento', ativo: false },
    { company_id: 'b', pharmacy_id: 'branch-b', local_user_id: 4, nome: 'Other company' },
  ];
  assert.equal(audit.auditAuthorName({ company_id: 'a', pharmacy_id: 'branch-b', usuario_id: 4 }, users), 'Bento');
  assert.equal(audit.auditAuthorName({ company_id: 'a', pharmacy_id: 'branch-a', usuario_id: 4 }, users), 'Ana');
  assert.equal(audit.auditAuthorName({ company_id: 'c', pharmacy_id: 'branch-b', usuario_id: 4 }, users), 'Utilizador não sincronizado');
  assert.equal(audit.auditAuthorName({ company_id: 'a', usuario_id: 4 }, users), 'Utilizador não sincronizado');
  assert.equal(audit.auditAuthorName({ usuario_id: 0 }, users), 'Sistema');
});

test('validity states use calendar dates in Maputo and keep products valid through their expiry date', () => {
  assert.equal(inventory.validityOf('2026-10-24', now).state, 'expired');
  assert.equal(inventory.validityOf('2026-10-25', now).label, 'Validade hoje');
  assert.equal(inventory.validityOf('2026-12-24', now).state, 'soon');
  assert.equal(inventory.validityOf('2026-12-25', now).state, 'current');
  assert.equal(inventory.validityOf('25/10/2026', now).days, 0);
  assert.equal(inventory.validityOf('2026-10-25T00:00:00Z', now).days, 0);
  assert.equal(inventory.validityOf('2026-10-25', new Date('2026-10-25T22:30:00Z')).state, 'expired');
  assert.equal(inventory.validityOf('2026-02-31', now).state, 'unknown');
  assert.equal(inventory.validityOf(null, now).state, 'unknown');
});

test('movement classifications and stock loss totals recognize damage and expiry', () => {
  assert.equal(helpers.movementTone({ tipo_movimento: 'AVARIA' }), 'attention');
  assert.equal(helpers.movementTone({ tipo_movimento: 'EXPIRAÇÃO' }), 'danger');
  assert.equal(helpers.movementTone({ tipo_movimento: 'ENTRADA' }), 'neutral');
  const rows = [{ tipo_movimento: 'AVARIA', quantidade: 50 }, { tipo_movimento: 'EXPIRACAO', quantidade: 9 }, { tipo_movimento: 'VENDA', quantidade: 10 }];
  assert.equal(rows.filter(helpers.isStockLossMovement).reduce((sum, row) => sum + row.quantidade, 0), 59);
  assert.equal(helpers.stockStatus({ quantidade: 0 }).state, 'expired');
  assert.equal(helpers.stockStatus({ quantidade: 5 }).state, 'soon');
  assert.equal(helpers.stockStatus({ quantidade: 6 }).state, 'current');
  assert.equal(helpers.stockStatus({}).state, 'unknown');
});

test('active counts honor ativo and expired branch licenses', () => {
  assert.equal(helpers.active({ ativo: false }), false);
  assert.equal(helpers.active({ ativo: true }), true);
  assert.equal(helpers.active({ status: 'INATIVO' }), false);
  assert.equal(helpers.active({ ativo: '0' }), false);
  assert.equal(helpers.activeBranch({ licenca_ativa: true, data_expiracao: '2000-01-01' }), false);
  assert.equal(helpers.activeBranch({ licenca_ativa: true, data_expiracao: '2999-12-31' }), true);
});

test('movement product matching never borrows another branch or an ambiguous batch', () => {
  const movement = { company_id: 'a', pharmacy_id: 'x', local_produto_id: 1, lote: 'L1' };
  const product = { ...movement, nome: 'Correct product', data_validade: '2027-01-01' };
  assert.equal(helpers.productForMovement(movement, [{ ...product, pharmacy_id: 'y' }, product]).nome, 'Correct product');
  assert.equal(helpers.productForMovement(movement, [{ ...product, company_id: 'b' }]), undefined);
  assert.equal(helpers.productForMovement(movement, [{ ...product, lote: 'L2' }]), undefined);
  assert.equal(helpers.productForMovement(movement, [product, { ...product }]), undefined);
});

const data = {
  company: { company_id: 'a', name: 'Hill Pharma', admin_email: 'admin@example.test', plan_type: 'BASIC' },
  userId: 'admin', pharmacies: [{ id: 'db-x', company_id: 'a', pharmacy_id: 'x', nome_filial: 'Central', licenca_ativa: true }],
  plans: [], products: [{ company_id: 'a', pharmacy_id: 'x', local_produto_id: 1, nome: 'Expired product', quantidade: 5, data_validade: '2000-01-01' }],
  sales: [], movements: [{ company_id: 'a', pharmacy_id: 'x', local_produto_id: 1, tipo_movimento: 'AVARIA', quantidade: 2 }],
  users: [{ company_id: 'a', pharmacy_id: 'x', local_user_id: 4, nome: 'Ana', ativo: true }, { company_id: 'a', pharmacy_id: 'x', local_user_id: 5, nome: 'Bento', ativo: false }],
  audits: [{ company_id: 'a', pharmacy_id: 'x', usuario_id: 4, acao: 'LOGIN' }],
  payments: [], messages: [], messageTable: 'system_messages', errors: {},
  notifications: [{ id: 'n1', company_id: 'a', pharmacy_id: 'x', tipo: 'EXPIRACAO', titulo: 'Notification from cloud', mensagem: 'Cloud notification body', lida: false, criada_em: '2026-10-25T10:00:00Z' }],
};

function pageRuntime(tab, client = {}) {
  let stateIndex = 0;
  const updates = [];
  const initial = { 0: data, 1: false, 4: tab };
  const mockReact = { ...React, useEffect() {}, useCallback: (callback) => callback, useMemo: (callback) => callback(), useState(value) { const index = stateIndex++; return [Object.hasOwn(initial, index) ? initial[index] : value, (next) => updates.push({ index, next })]; } };
  const module = compile(sourceText, {
    react: mockReact,
    'react-router-dom': { useNavigate: () => () => {}, useSearchParams: () => [new URLSearchParams('company_id=a')], Link: ({ to, children, ...props }) => React.createElement('a', { ...props, href: to }, children) },
    '../lib/supabase': { supabase: client }, '../lib/support': lib('support'), '../lib/audit': audit, '../lib/plans': plans, '../lib/inventory': inventory,
    './Dashboard.module.css': { __esModule: true, default: new Proxy({}, { get: (_, key) => key }) },
  });
  return { Component: module.default, updates };
}

test('inventory, audit, network and notifications render with real names, statuses and bounded lists', () => {
  const render = (tab) => renderToStaticMarkup(React.createElement(pageRuntime(tab).Component));
  const stock = render('inventory');
  assert.match(stock, /class="expiredRow"/);
  assert.match(stock, /movementType toneattention/);
  assert.match(stock, /Expirado/);
  assert.match(stock, /tableScrollable/);
  assert.match(render('audit'), /<td>Ana<\/td>/);
  const network = render('network');
  assert.match(network, /Utilizadores ativos<\/span><strong class="metricValue">1<\/strong>/);
  assert.match(network, /1 ativos · 2 registados/);
  assert.match(network, /Subscrição Básico/);
  const notifications = render('notifications');
  assert.match(notifications, /Cloud notification body/);
  assert.match(notifications, /Não lida/);
  assert.match(notifications, /notificationList/);
});

test('refresh requests cloud notifications with the complete schema and company filter', async () => {
  const calls = [];
  const client = { auth: { getUser: async () => ({ data: { user: { id: 'admin', email: 'admin@example.test' } }, error: null }) }, from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const values = { companies: data.company, pharmacies: data.pharmacies, plans: [], cloud_produtos: data.products, cloud_vendas: [], cloud_estoque_movimentos: data.movements, cloud_usuarios: data.users, cloud_audit_logs: data.audits, payments_log: [], system_messages: [], cloud_notificacoes: [...data.notifications, { ...data.notifications[0], id: 'foreign', company_id: 'other' }] };
    const result = { data: values[table], error: null, status: 200, statusText: 'OK' };
    const query = { select(columns) { call.columns = columns; return this; }, eq(key, value) { call.filters.push([key, value]); return this; }, limit() { return this; }, order(column, options) { call.order = [column, options]; return this; }, maybeSingle() { return Promise.resolve(result); }, then(resolve, reject) { return Promise.resolve(result).then(resolve, reject); } };
    return query;
  } };
  const runtime = pageRuntime('overview', client);
  const tree = runtime.Component();
  function find(node) {
    if (!node || typeof node !== 'object') return undefined;
    if (node.props?.['aria-label'] === 'Sincronizar dados') return node;
    return React.Children.toArray(node.props?.children).map(find).find(Boolean);
  }
  find(tree).props.onClick();
  await new Promise((resolve) => setImmediate(resolve));
  const notificationCall = calls.find((call) => call.table === 'cloud_notificacoes');
  assert(notificationCall);
  assert.deepEqual(notificationCall.filters, [['company_id', 'a']]);
  assert.equal(notificationCall.columns, 'id,company_id,pharmacy_id,chave,tipo,titulo,mensagem,lida,criada_em');
  assert.equal(notificationCall.order[0], 'criada_em');
  const refreshed = runtime.updates.find((update) => update.index === 0 && update.next)?.next;
  assert.equal(refreshed.notifications.length, 1);
  assert.equal(refreshed.notifications[0].company_id, 'a');
});

test('CSS modules parse and every page style reference exists', () => {
  for (const name of ['Dashboard', 'Plans']) {
    const css = postcss.parse(fs.readFileSync(path.join(root, 'src/pages', name + '.module.css'), 'utf8'));
    const classes = new Set();
    css.walkRules((rule) => { for (const match of rule.selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)) classes.add(match[1]); });
    const text = fs.readFileSync(path.join(root, 'src/pages', name + '.tsx'), 'utf8');
    for (const match of text.matchAll(/styles\.([a-zA-Z_][\w-]*)/g)) assert(classes.has(match[1]), name + '.' + match[1]);
    if (name === 'Dashboard') for (const dynamic of ['stateexpired', 'statesoon', 'statecurrent', 'stateunknown', 'tonedanger', 'toneattention', 'toneneutral']) assert(classes.has(dynamic), dynamic);
  }
});
