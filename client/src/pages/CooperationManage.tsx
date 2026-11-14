import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Space, Tag, message,
  Typography, Tooltip, Descriptions, Tabs,
  Alert, Input,
} from 'antd';
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LinkOutlined,
  SearchOutlined,
  ReloadOutlined,
  ExportOutlined,
  EyeOutlined,
  DeleteOutlined,
  InfoCircleOutlined,
  StopOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  amTargetSupplier, ensureCredsMigrated, withCooperationCreds, supplierNoOf,
  myCompanyNo, purchaserUsernameOf, noOfUser,
} from '../utils/cooperationCred';

const { Text, Title } = Typography;

const PRIMARY = '#1e4a7e';
const COOPERATION_APPLICATIONS_KEY = 'cooperation_applications';

interface CooperationApplication {
  applicationId: string;
  purchaserUsername: string;
  purchaserCompanyName: string;
  purchaserCompanyId: string;
  purchaserContact: string;
  purchaserPhone: string;
  targetSupplierName: string;
  targetSupplierId: string;
  /** 目标供应商公司编号（本链路唯一身份凭证，历史数据由迁移补写） */
  targetSupplierNo?: string;
  /** 发起采购商公司编号 */
  purchaserNo?: string;
  purchaserSupplierEntryId?: string;
  canDirectApprove: boolean;
  applyDate: string;
  status: 'pending' | 'approved' | 'rejected';
  remark: string;
  supplierInitiated?: boolean;
  inviteToken?: string;
  type?: 'cooperation' | 'terminate';
  customerId?: string;
}

interface CooperationRecord {
  key: string;
  applicationId: string;
  purchaserName: string;
  purchaserCompanyName: string;
  purchaserCompanyId: string;
  purchaserContact: string;
  purchaserPhone: string;
  supplierName: string;
  cooperationStatus: 'pending' | 'approved' | 'rejected';
  canDirectApprove: boolean;
  supplierInitiated?: boolean;
  applyDate: string;
  approveDate?: string;
  remark: string;
  inviteToken?: string;
  type?: 'cooperation' | 'terminate';
  customerId?: string;
  /** 本公司是否该申请的目标供应商（按公司编号判定），决定能否批准/拒绝 */
  canHandle: boolean;
}

const toRecord = (app: CooperationApplication): CooperationRecord => ({
  key: app.applicationId,
  applicationId: app.applicationId,
  purchaserName: app.purchaserCompanyName || app.purchaserUsername,
  purchaserCompanyName: app.purchaserCompanyName,
  purchaserCompanyId: app.purchaserCompanyId,
  purchaserContact: app.purchaserContact,
  purchaserPhone: app.purchaserPhone,
  supplierName: app.targetSupplierName,
  cooperationStatus: app.status,
  canDirectApprove: app.canDirectApprove,
  supplierInitiated: app.supplierInitiated,
  inviteToken: app.inviteToken,
  type: app.type || 'cooperation',
  applyDate: app.applyDate,
  remark: app.remark,
  customerId: app.customerId,
  canHandle: amTargetSupplier(app),
});

/**
 * 供应商侧可见性：以公司编号等值判定“这条申请是不是发给本公司的”。
 * 旧实现用名称双向 includes 匹配，同名公司的多个账号、以及名称互为子串的两家公司会互串申请。
 */
const loadApplications = (): CooperationRecord[] => {
  try {
    ensureCredsMigrated();
    const allApps: CooperationApplication[] = JSON.parse(
      localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
    );
    return allApps.filter((app) => amTargetSupplier(app)).map(toRecord).reverse();
  } catch {
    return [];
  }
};

const CooperationManage: React.FC = () => {
  const [dataSource, setDataSource] = useState<CooperationRecord[]>(loadApplications);
  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<CooperationRecord | null>(null);
  const [detailVisible, setDetailVisible] = useState(false);

  const reloadData = useCallback(() => {
    setDataSource(loadApplications());
  }, []);

  useEffect(() => {
    reloadData();
    const handleStorage = (e: StorageEvent) => {
      if (e.key === COOPERATION_APPLICATIONS_KEY) {
        reloadData();
      }
    };
    const handleCustomRefresh = () => reloadData();
    window.addEventListener('storage', handleStorage);
    window.addEventListener('cooperation-applications-changed', handleCustomRefresh);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('cooperation-applications-changed', handleCustomRefresh);
    };
  }, [reloadData]);

  // ========== 统计 ==========
  const stats = useMemo(() => {
    const total = dataSource.length;
    const cooperationPending = dataSource.filter(
      (s) => (!s.type || s.type === 'cooperation') && s.cooperationStatus === 'pending'
    ).length;
    const approved = dataSource.filter((s) => s.cooperationStatus === 'approved').length;
    const rejected = dataSource.filter((s) => s.cooperationStatus === 'rejected').length;
    const terminatePending = dataSource.filter(
      (s) => s.type === 'terminate' && s.cooperationStatus === 'pending'
    ).length;
    return { total, cooperationPending, approved, rejected, terminatePending };
  }, [dataSource]);

  // ========== 筛选 ==========
  const filteredData = useMemo(() => {
    return dataSource.filter((s) => {
      const matchSearch =
        !searchText ||
        s.purchaserName.includes(searchText) ||
        s.purchaserCompanyName.includes(searchText) ||
        s.purchaserContact.includes(searchText) ||
        s.purchaserPhone.includes(searchText) ||
        s.supplierName.includes(searchText);
      const matchStatus =
        !statusFilter ||
        statusFilter === 'pending' && (!s.type || s.type === 'cooperation') ||
        statusFilter === 'terminate' && s.type === 'terminate' ||
        (statusFilter !== 'pending' && statusFilter !== 'terminate' && s.cooperationStatus === statusFilter);
      return matchSearch && matchStatus;
    });
  }, [dataSource, searchText, statusFilter]);

  // ========== 身份守卫 ==========
  // 申请记录存在全局共享键里，会送达所有浏览器；只有公司编号与本方一致的目标供应商才能处理，
  // 否则同名账号会互相把对方的申请批准/拒绝/删除掉。
  const guardHandle = (record: CooperationRecord): boolean => {
    if (record.canHandle) return true;
    message.error(`该申请指向的供应商编号与本账号公司编号不一致，无法由本公司处理`);
    reloadData();
    return false;
  };

  // ========== 删除合作记录 ==========
  const handleDelete = (record: CooperationRecord) => {
    if (!guardHandle(record)) return;
    Modal.confirm({
      title: '确认删除',
      content: `确定要删除与 ${record.purchaserName} 的合作记录吗？`,
      okText: '确认删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        setDataSource((prev) => prev.filter((item) => item.key !== record.key));
        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updated = apps.filter((app) => app.applicationId !== record.applicationId);
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updated));
        message.success('合作记录已删除');
      },
    });
  };

  // ========== 确认合作申请 ==========
  const handleApprove = (record: CooperationRecord) => {
    if (!guardHandle(record)) return;
    Modal.confirm({
      title: '确认通过',
      content: `确定通过 ${record.purchaserName} 的合作申请吗？通过后将自动添加到客户基础信息列表。`,
      okText: '确认通过',
      cancelText: '取消',
      onOk: () => {
        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updated = apps.map((app) =>
          app.applicationId === record.applicationId
            ? { ...app, status: 'approved' as const }
            : app
        );
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updated));

        // 将采购商公司信息添加到供应商的客户基础信息列表
        try {
          const supplierUsername = localStorage.getItem('username') || '';
          const storageKey = 'boundPurchasers_' + supplierUsername;
          const boundPurchasers: any[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
          // 用采购商公司名称匹配，而不是 username
          const purchaserCompany = record.purchaserCompanyName || record.purchaserName;
          // 查找关联的申请记录，获取采购商账号用户名
          const thisApp = apps.find((app) => app.applicationId === record.applicationId);
          const customerId = thisApp?.customerId || record.customerId || '';
          const purchaserUsername = thisApp?.purchaserUsername || '';
          // 从采购商账号（registeredUsers）获取完整企业信息
          let purchaserInfo: any = {};
          if (purchaserUsername) {
            try {
              const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
              const purchaserUser = registeredUsers.find((u: any) => u.username === purchaserUsername);
              if (purchaserUser) {
                purchaserInfo = {
                  purchaserUsername,
                  purchaserContact: purchaserUser.contactPerson || record.purchaserContact || '',
                  purchaserPhone: purchaserUser.phone || record.purchaserPhone || '',
                  legalPerson: purchaserUser.legalPerson || '',
                  wechatQr: purchaserUser.wechatQr || '',
                  businessAddress: purchaserUser.businessAddress || '',
                  email: purchaserUser.email || '',
                };
              }
            } catch { /* ignore */ }
          }
          // 匹配兼顾公司名与采购商账号：公司名可能因改名/简称与快照不一致，仅按名称匹配会重复新建一条
          const existingIdx = boundPurchasers.findIndex(
            (bp: any) => bp.purchaserName === purchaserCompany || (purchaserUsername && bp.purchaserUsername === purchaserUsername)
          );
          if (existingIdx >= 0) {
            // 已存在的采购商（如曾终止合作后重新合作），更新状态为已合作并同步企业信息
            boundPurchasers[existingIdx] = {
              ...boundPurchasers[existingIdx],
              status: 'approved',
              bindDate: dayjs().format('YYYY-MM-DD'),
              statusTs: Date.now(),
              terminateAt: undefined,
              terminateBy: undefined,
              ...purchaserInfo,
            };
          } else {
            boundPurchasers.push({
              key: `bp-${Date.now()}`,
              id: `BIND-${Date.now()}`,
              purchaserName: purchaserCompany,
              purchaserUsername: purchaserUsername || '',
              purchaserContact: record.purchaserContact || '',
              purchaserPhone: record.purchaserPhone || '',
              ...purchaserInfo,
              bindDate: dayjs().format('YYYY-MM-DD'),
              status: 'approved',
              customerId,
            });
          }
          localStorage.setItem(storageKey, JSON.stringify(boundPurchasers));
          window.dispatchEvent(new Event('bound-purchasers-changed'));
        } catch { /* ignore */ }

        // 同步更新采购商端供应商列表状态
        try {
          const appsAfter = JSON.parse(
            localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
          );
          const approvedApp = appsAfter.find(
            (app: any) => app.applicationId === record.applicationId
          );
          if (approvedApp && approvedApp.purchaserUsername) {
            const purchaserStorageKey = 'purchaser_suppliers_' + approvedApp.purchaserUsername;
            const suppliers: any[] = JSON.parse(localStorage.getItem(purchaserStorageKey) || '[]');
            const approvedSupplierUsername = (approvedApp as any).supplierUsername || '';
            // 匹配须兼顾名称/供应商账号回退：本浏览器持有的采购商键副本可能陈旧缺条目，
            // 仅按 purchaserSupplierEntryId 匹配会落空进而走自动新增，产生同供应商双条目
            const existingIdx = suppliers.findIndex((s: any) => {
              if (approvedApp.purchaserSupplierEntryId && s.id === approvedApp.purchaserSupplierEntryId) return true;
              if (s.id === approvedApp.targetSupplierId) return true;
              if (s.supplierName === record.supplierName) return true;
              if (approvedSupplierUsername && s.supplierUsername === approvedSupplierUsername) return true;
              return false;
            });
            if (existingIdx >= 0) {
              suppliers[existingIdx] = {
                ...suppliers[existingIdx],
                cooperationStatus: 'approved',
                cooperationDate: dayjs().format('YYYY-MM-DD'),
                statusTs: Date.now(),
                terminateAt: undefined,
                terminateBy: undefined,
                supplierUsername: suppliers[existingIdx].supplierUsername || (localStorage.getItem('username') || ''),
                supplierName: record.supplierName || suppliers[existingIdx].supplierName,
              };
            } else {
              // 采购商侧没有该供应商条目（通过链接直接申请且没有手动新增），自动新增；
              // 档案字段取供应商注册信息，不得复用采购商联系人（历史缺陷：曾把采购商联系人写入供应商档案）
              let supUser: any = null;
              try {
                const registeredUsers2: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
                const cands = registeredUsers2.filter((u: any) =>
                  (approvedSupplierUsername && u.username === approvedSupplierUsername) ||
                  (u.companyName || '') === record.supplierName);
                // 同名账号消歧：优先取 boundPurchasers 中确实绑定了该采购商的账号
                supUser = cands.find((c: any) => {
                  try {
                    const b: any[] = JSON.parse(localStorage.getItem('boundPurchasers_' + c.username) || '[]');
                    return b.some((bp: any) => bp.purchaserUsername === approvedApp.purchaserUsername || bp.purchaserName === approvedApp.purchaserCompanyName);
                  } catch { return false; }
                }) || cands[0] || null;
              } catch { /* ignore */ }
              suppliers.unshift({
                id: approvedApp.purchaserSupplierEntryId || approvedApp.targetSupplierId || `SP-${Date.now()}`,
                supplierUsername: supUser?.username || approvedSupplierUsername || (localStorage.getItem('username') || ''),
                supplierNo: supUser?.companyNo || '',
                supplierName: record.supplierName,
                shortName: '',
                contactPerson: supUser?.contactPerson || '',
                contactPhone: supUser?.phone || '',
                email: supUser?.email || '',
                cooperationStatus: 'approved',
                addedDate: dayjs().format('YYYY-MM-DD HH:mm:ss'),
                cooperationDate: dayjs().format('YYYY-MM-DD'),
                cooperationToken: approvedApp.inviteToken || '',
                remark: '通过邀约链接建立合作',
                purchaserCompanyId: '',
              });
            }
            localStorage.setItem(purchaserStorageKey, JSON.stringify(suppliers));
          }
        } catch { /* ignore */ }

        message.success('合作申请已通过，采购商已添加到客户基础信息列表');
        window.dispatchEvent(new Event('cooperation-applications-changed'));
        // 强制重新加载数据，确保页面状态同步
        reloadData();
      },
    });
  };

  // ========== 拒绝合作申请 ==========
  const handleReject = (record: CooperationRecord) => {
    if (!guardHandle(record)) return;
    Modal.confirm({
      title: '确认拒绝',
      content: `确定拒绝 ${record.purchaserName} 的合作申请吗？`,
      okText: '确认拒绝',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updated = apps.map((app) =>
          app.applicationId === record.applicationId
            ? { ...app, status: 'rejected' as const }
            : app
        );
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updated));
        setDataSource((prev) =>
          prev.map((item) =>
            item.key === record.key ? { ...item, cooperationStatus: 'rejected' as const } : item
          )
        );
        message.warning('合作申请已拒绝');
        window.dispatchEvent(new Event('cooperation-applications-changed'));
      },
    });
  };

  // ========== 确认终止合作申请（供应商侧）==========
  const handleApproveTerminate = (record: CooperationRecord) => {
    if (!guardHandle(record)) return;
    Modal.confirm({
      title: '确认终止合作',
      content: `确定终止与「${record.purchaserName}」的合作关系吗？终止后双方状态将改为"待合作"。`,
      okText: '确认终止',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        const supplierUsername = localStorage.getItem('username') || '';

        // 1. 更新 cooperation_applications 中的终止申请状态
        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updated = apps.map((app) =>
          app.applicationId === record.applicationId
            ? { ...app, status: 'approved' as const }
            : app
        );
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updated));

        // 2. 同步更新供应商端客户基础信息 - 改为已解除合作
        try {
          const storageKey = 'boundPurchasers_' + supplierUsername;
          const cooperativeData = localStorage.getItem(storageKey);
          if (cooperativeData) {
            const cooperativePurchasers: any[] = JSON.parse(cooperativeData);
            const updatedPurchasers = cooperativePurchasers.map((bp: any) => {
              if (bp.purchaserName === record.purchaserName) {
                return { ...bp, status: 'terminated' };
              }
              return bp;
            });
            localStorage.setItem(storageKey, JSON.stringify(updatedPurchasers));
          }
        } catch { /* ignore */ }

        // 3. 同步更新采购商端的供应商列表状态 → 改为已终止
        try {
          const appsAfterUpdate: CooperationApplication[] = JSON.parse(
            localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
          );
          const terminateApp = appsAfterUpdate.find(
            (app) => app.applicationId === record.applicationId
          );
          if (terminateApp && terminateApp.purchaserUsername) {
            const purchaserStorageKey = 'purchaser_suppliers_' + terminateApp.purchaserUsername;
            const purchaserData = localStorage.getItem(purchaserStorageKey);
            if (purchaserData) {
              const suppliers: any[] = JSON.parse(purchaserData);
              const updatedSuppliers = suppliers.map((s) => {
                // 凭证优先：编号/条目 id 等值；只在两者都不可用时才回退名称匹配
                const isMatch = terminateApp.purchaserSupplierEntryId
                  ? s.id === terminateApp.purchaserSupplierEntryId
                  : (supplierNoOf(terminateApp) && String(s.supplierNo || '') === supplierNoOf(terminateApp))
                    || s.id === terminateApp.targetSupplierId
                    || (!supplierNoOf(terminateApp) && s.supplierName === record.supplierName);
                if (isMatch && (s.cooperationStatus === 'terminating' || s.cooperationStatus === 'approved')) {
                  return { ...s, cooperationStatus: 'terminated', terminateApplyDate: undefined };
                }
                return s;
              });
              localStorage.setItem(purchaserStorageKey, JSON.stringify(updatedSuppliers));
            }
          }
        } catch { /* ignore */ }

        // 4. 更新页面数据源
        setDataSource((prev) =>
          prev.map((item) =>
            item.key === record.key ? { ...item, cooperationStatus: 'approved' as const } : item
          )
        );

        // 5. 触发自定义事件，通知客户基本信息页面和合作申请页面刷新
        window.dispatchEvent(new Event('supplier-terminate-success'));
        window.dispatchEvent(new Event('cooperation-applications-changed'));

        message.success(`已确认与「${record.purchaserName}」终止合作，双方合作关系已解除`);
      },
    });
  };

  // ========== 拒绝终止合作申请 ==========
  const handleRejectTerminate = (record: CooperationRecord) => {
    if (!guardHandle(record)) return;
    Modal.confirm({
      title: '拒绝终止合作',
      content: `确定拒绝「${record.purchaserName}」的终止合作申请吗？`,
      okText: '确认拒绝',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updated = apps.map((app) =>
          app.applicationId === record.applicationId
            ? { ...app, status: 'rejected' as const }
            : app
        );
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updated));
        setDataSource((prev) =>
          prev.map((item) =>
            item.key === record.key ? { ...item, cooperationStatus: 'rejected' as const } : item
          )
        );

        // 同步更新采购商端供应商状态 - 恢复为已合作
        try {
          const appsAfter: CooperationApplication[] = JSON.parse(
            localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
          );
          const rejectApp = appsAfter.find(
            (app) => app.applicationId === record.applicationId
          );
          if (rejectApp && rejectApp.purchaserUsername) {
            const purchaserStorageKey = 'purchaser_suppliers_' + rejectApp.purchaserUsername;
            const purchaserData = localStorage.getItem(purchaserStorageKey);
            if (purchaserData) {
              const suppliers: any[] = JSON.parse(purchaserData);
              const updatedSuppliers = suppliers.map((s) => {
                const noMatch = rejectApp ? supplierNoOf(rejectApp) : '';
                const isMatch = (noMatch && String(s.supplierNo || '') === noMatch)
                  || s.id === String(rejectApp?.targetSupplierId || '')
                  || (!noMatch && s.supplierName === record.supplierName);
                if (isMatch && s.cooperationStatus === 'terminating') {
                  return { ...s, cooperationStatus: 'approved', terminateApplyDate: undefined };
                }
                return s;
              });
              localStorage.setItem(purchaserStorageKey, JSON.stringify(updatedSuppliers));
            }
          }
        } catch { /* ignore */ }

        message.warning(`已拒绝「${record.purchaserName}」的终止合作申请`);
        window.dispatchEvent(new Event('cooperation-applications-changed'));
      },
    });
  };

  // ========== 重新发起合作（供应商侧，终止/拒绝后闭环）==========
  // 合作申请记录对应的合作关系是否已结束（绑定记录 terminated 或申请被拒绝）
  const isPartnershipEnded = useCallback((record: CooperationRecord) => {
    if (record.cooperationStatus === 'rejected') return true;
    try {
      const bound: any[] = JSON.parse(localStorage.getItem(`boundPurchasers_${localStorage.getItem('username') || ''}`) || '[]');
      return bound.some((b: any) => b.purchaserName === record.purchaserName && b.status === 'terminated');
    } catch { return false; }
  }, []);

  const handleReInitiateCooperation = (record: CooperationRecord) => {
    if (!guardHandle(record)) return;
    const username = localStorage.getItem('username') || '';
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUser = registeredUsers.find((u: any) => u.username === username);
    const myCompany = currentUser?.companyName || username;
    const myNo = myCompanyNo() || noOfUser(currentUser);
    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');
    // 定位采购商账号：优先绑定记录账号，回退按采购商编号解析，最后才按公司名唯一命中
    let purchaserUsername = '';
    try {
      const bound: any[] = JSON.parse(localStorage.getItem(`boundPurchasers_${username}`) || '[]');
      const bp = bound.find((b: any) => b.purchaserName === record.purchaserName);
      purchaserUsername = bp?.purchaserUsername || '';
    } catch { /* ignore */ }
    if (!purchaserUsername) purchaserUsername = purchaserUsernameOf(record);
    if (!purchaserUsername) {
      const byName = registeredUsers.filter((u: any) => u.companyName === record.purchaserName);
      purchaserUsername = byName.length === 1 ? String(byName[0].username) : '';
    }
    if (!purchaserUsername) { message.error('无法定位该采购商账号，请在客户基础信息通过「邀约合作/采购商编号」发起'); return; }
    const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
    // 同一对方判定凭证优先：编号相等即同一家；无编号的历史记录才按名称全等兜底
    const samePeerApp = (a: any) => a.purchaserUsername === purchaserUsername
      && (myNo ? supplierNoOf(a) === myNo : String(a.targetSupplierName || '').trim() === String(myCompany || '').trim());
    const dupPending = apps.some((a: any) => (a.type || 'cooperation') === 'cooperation' && !a.superseded && a.status === 'pending' && samePeerApp(a));
    if (dupPending) { message.warning('该采购商已有待处理的合作申请，无需重复发起'); return; }
    apps.forEach((a: any) => {
      if (samePeerApp(a) && (a.type || 'cooperation') === 'cooperation' && a.status === 'approved') a.superseded = true;
    });
    // 采购商侧供应商列表条目：复用已有条目（终止/拒绝回退待确认），缺失则新建
    const pKey = 'purchaser_suppliers_' + purchaserUsername;
    let list: any[] = [];
    try { list = JSON.parse(localStorage.getItem(pKey) || '[]'); } catch { /* ignore */ }
    let entryId = '';
    const existIdx = list.findIndex((s: any) => (myNo && String(s.supplierNo || '') === myNo) || s.supplierName === myCompany);
    if (existIdx >= 0) {
      if (list[existIdx].cooperationStatus === 'terminated' || list[existIdx].cooperationStatus === 'rejected') {
        list[existIdx] = { ...list[existIdx], cooperationStatus: 'pending' };
      }
      // 供应商主动发起标记：随 purchaser_suppliers_ 同步键跨浏览器送达，采购商侧据此显示待审核
      list[existIdx] = { ...list[existIdx], supplierNo: myNo || list[existIdx].supplierNo || '', supplierInitiated: true, supplierUsername: username, supplierInitiatedDate: now };
      entryId = list[existIdx].id;
    } else {
      entryId = `SP-${Date.now()}`;
      list.unshift({
        id: entryId,
        supplierName: myCompany,
        supplierNo: myNo,
        shortName: '',
        contactPerson: currentUser?.contactPerson || '',
        contactPhone: currentUser?.phone || '',
        email: '',
        cooperationStatus: 'pending',
        addedDate: now,
        remark: '供应商重新发起合作',
        supplierInitiated: true,
        supplierUsername: username,
        supplierInitiatedDate: now,
      });
    }
    localStorage.setItem(pKey, JSON.stringify(list));
    apps.push(withCooperationCreds({
      applicationId: `COOP-REINIT-${Date.now()}`,
      purchaserUsername,
      purchaserCompanyName: record.purchaserName,
      purchaserCompanyId: record.purchaserCompanyId || '',
      purchaserContact: record.purchaserContact || '',
      purchaserPhone: record.purchaserPhone || '',
      targetSupplierName: myCompany,
      targetSupplierNo: myNo,
      targetSupplierId: entryId,
      supplierUsername: username,
      canDirectApprove: false,
      applyDate: now,
      status: 'pending',
      remark: `供应商「${myCompany}」申请重新建立合作`,
      type: 'cooperation',
      supplierInitiated: true,
    }));
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));
    window.dispatchEvent(new Event('cooperation-applications-changed'));
    message.success(`已重新发起合作申请，等待采购商「${record.purchaserName}」在其合作申请中通过`);
  };

  // ========== 表格列 ==========
  const columns = [
    {
      title: '申请ID',
      dataIndex: 'applicationId',
      key: 'applicationId',
      width: 130,
    },
    {
      title: '采购商名称',
      dataIndex: 'purchaserName',
      key: 'purchaserName',
      width: 200,
    },
    {
      title: '采购商ID',
      dataIndex: 'purchaserCompanyId',
      key: 'purchaserCompanyId',
      width: 120,
      render: (v: string) => v || <Tag color="default">未提供</Tag>,
    },
    {
      title: '联系人',
      dataIndex: 'purchaserContact',
      key: 'purchaserContact',
      width: 100,
    },
    {
      title: '联系电话',
      dataIndex: 'purchaserPhone',
      key: 'purchaserPhone',
      width: 130,
    },
    {
      title: '供应商名称',
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 180,
    },
    {
      title: '申请类型',
      key: 'type',
      width: 100,
      render: (_: any, record: CooperationRecord) => {
        const t = record.type || 'cooperation';
        return (
          <Tag color={t === 'terminate' ? 'orange' : 'blue'}>
            {t === 'terminate' ? '终止合作' : '合作'}
          </Tag>
        );
      },
    },
    {
      title: '合作状态',
      dataIndex: 'cooperationStatus',
      key: 'cooperationStatus',
      width: 110,
      render: (status: string, record: CooperationRecord) => (
        <Space size={4}>
          <Tag
            color={
              status === 'approved' ? 'green' : status === 'rejected' ? 'red' : 'orange'
            }
          >
            {status === 'approved' ? '已通过' : status === 'rejected' ? '已拒绝' : '待审核'}
          </Tag>
        </Space>
      ),
    },
    {
      title: '申请日期',
      dataIndex: 'applyDate',
      key: 'applyDate',
      width: 130,
      render: (v: string) => v?.split(' ')[0] || v,
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      fixed: 'right' as const,
      render: (_: any, record: CooperationRecord) => (
        <Space size="small" wrap>
          <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => { setSelectedRecord(record); setDetailVisible(true); }}>
            查看
          </Button>
          {/* 非本方编号的申请只读：不提供批准/拒绝/删除，避免同名账号互相误操作 */}
          {!record.canHandle && record.cooperationStatus !== 'approved' && (
            <Tooltip title="该申请的目标供应商编号与本账号公司编号不一致，仅可查看">
              <Tag color="default">非本公司</Tag>
            </Tooltip>
          )}
          {/* 合作申请的操作 */}
          {record.canHandle && (!record.type || record.type === 'cooperation') && record.cooperationStatus === 'pending' && (
            <>
              <Button type="link" size="small" style={{ color: '#52c41a' }} icon={<CheckCircleOutlined />} onClick={() => handleApprove(record)}>
                通过
              </Button>
              <Button type="link" size="small" danger icon={<CloseCircleOutlined />} onClick={() => handleReject(record)}>
                拒绝
              </Button>
            </>
          )}
          {/* 终止/拒绝后重新发起合作（闭环：对方合作申请页可见并可同意） */}
          {record.canHandle && (!record.type || record.type === 'cooperation') && record.cooperationStatus !== 'pending' && isPartnershipEnded(record) && (
            <Button type="link" size="small" style={{ color: '#52c41a' }} icon={<CheckCircleOutlined />} onClick={() => handleReInitiateCooperation(record)}>
              重新发起合作
            </Button>
          )}
          {/* 终止合作申请的操作 */}
          {record.canHandle && record.type === 'terminate' && record.cooperationStatus === 'pending' && (
            <>
              <Button type="link" size="small" style={{ color: '#52c41a' }} icon={<CheckCircleOutlined />} onClick={() => handleApproveTerminate(record)}>
                确认终止
              </Button>
              <Button type="link" size="small" danger icon={<CloseCircleOutlined />} onClick={() => handleRejectTerminate(record)}>
                拒绝
              </Button>
            </>
          )}
          {/* 已合作的操作 - 不能直接删除，需先终止合作 */}
          {record.cooperationStatus === 'approved' && (
            <Tooltip title="请先在客户基础信息页面发起解除合作">
              <Button type="link" size="small" danger icon={<StopOutlined />} disabled>
                解除合作
              </Button>
            </Tooltip>
          )}
          {/* 未合作的操作 */}
          {record.canHandle && record.cooperationStatus !== 'approved' && (
            <Button type="link" size="small" danger icon={<DeleteOutlined />} onClick={() => handleDelete(record)}>
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  // ========== Tab 项 ==========
  const tabItems = [
    { key: '', label: `全部 (${stats.total})` },
    { key: 'pending', label: `合作申请 (${stats.cooperationPending})` },
    { key: 'terminate', label: `终止合作申请 (${stats.terminatePending})` },
    { key: 'approved', label: `已通过 (${stats.approved})` },
    { key: 'rejected', label: `已拒绝 (${stats.rejected})` },
  ];

  return (
    <div>
      {/* 页面头部 */}
      <div
        style={{
          background: `linear-gradient(135deg, ${PRIMARY} 0%, #2d5a8e 100%)`,
          color: '#fff',
          padding: '20px 28px',
          borderRadius: 12,
          marginBottom: 20,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 10,
              background: 'rgba(255,255,255,0.15)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <LinkOutlined style={{ fontSize: 22, color: '#fff' }} />
          </div>
          <div>
            <Title level={4} style={{ color: '#fff', margin: 0, fontSize: 18 }}>
              合作申请
            </Title>
            <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>
              查看和处理采购商发起的合作申请，审批通过后自动同步到客户列表
            </Text>
          </div>
        </div>
        <Space>
          <Button ghost icon={<ReloadOutlined />} onClick={reloadData}>
            刷新
          </Button>
          <Button ghost icon={<ExportOutlined />}>
            导出
          </Button>
        </Space>
      </div>

      {/* 提示信息 */}
      <Alert
        type="info"
        showIcon
        message="合作申请说明"
        description={
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <p style={{ margin: '4px 0' }}>
              <Tag color="blue" style={{ fontSize: 11 }}>合作申请</Tag> 采购商通过邀约链接发起的合作请求，需供应商审批。审批通过后自动添加到客户基础信息列表。
            </p>
            <p style={{ margin: '4px 0' }}>
              <Tag color="orange" style={{ fontSize: 11 }}>终止合作申请</Tag> 采购商发起的终止合作请求，需供应商确认。确认后双方状态改为"待合作"。
            </p>
          </div>
        }
        style={{ marginBottom: 16 }}
      />

      {/* 搜索 & 筛选 */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <Space>
            <Input.Search
              placeholder="搜索采购商名称、联系人或编号"
              allowClear
              style={{ width: 280 }}
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
            />
            <Tabs
              activeKey={statusFilter}
              onChange={setStatusFilter}
              items={tabItems}
              size="small"
              style={{ marginBottom: 0 }}
            />
          </Space>
        </div>
      </Card>

      {/* 申请列表 */}
      <Card size="small">
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="key"
          size="middle"
          pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (t) => `共 ${t} 条` }}
          scroll={{ x: 1200 }}
          locale={{ emptyText: '暂无合作申请' }}
        />
      </Card>

      {/* 详情弹窗 */}
      <Modal
        title={
          <span>
            <EyeOutlined style={{ marginRight: 8 }} />
            合作申请详情
          </span>
        }
        open={detailVisible}
        onCancel={() => { setDetailVisible(false); setSelectedRecord(null); }}
        footer={
          <Button onClick={() => { setDetailVisible(false); setSelectedRecord(null); }}>
            关闭
          </Button>
        }
        width={520}
      >
        {selectedRecord && (
          <Descriptions column={2} bordered size="small" style={{ marginTop: 12 }}>
            <Descriptions.Item label="申请ID">{selectedRecord.applicationId}</Descriptions.Item>
            <Descriptions.Item label="申请类型">
              <Tag color={selectedRecord.type === 'terminate' ? 'orange' : 'blue'}>
                {selectedRecord.type === 'terminate' ? '终止合作' : '合作'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="采购商名称" span={2}>
              {selectedRecord.purchaserName}
            </Descriptions.Item>
            <Descriptions.Item label="采购商ID">
              {selectedRecord.purchaserCompanyId || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="联系人">
              {selectedRecord.purchaserContact || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="联系电话">
              {selectedRecord.purchaserPhone || '-'}
            </Descriptions.Item>
            <Descriptions.Item label="供应商名称" span={2}>
              {selectedRecord.supplierName}
            </Descriptions.Item>
            <Descriptions.Item label="合作状态" span={2}>
              <Tag
                color={
                  selectedRecord.cooperationStatus === 'approved'
                    ? 'green'
                    : selectedRecord.cooperationStatus === 'rejected'
                    ? 'red'
                    : 'orange'
                }
              >
                {selectedRecord.cooperationStatus === 'approved'
                  ? '已通过'
                  : selectedRecord.cooperationStatus === 'rejected'
                  ? '已拒绝'
                  : '待审核'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="申请日期">
              {selectedRecord.applyDate}
            </Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>
              {selectedRecord.remark || '-'}
            </Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default CooperationManage;
