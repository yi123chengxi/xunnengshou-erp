import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  Card, Table, Button, Modal, Form, Input, Space, Tag, message,
  Typography, Popconfirm, Tooltip, Descriptions, Row, Col, Statistic, Tabs,
} from 'antd';
import {
  LinkOutlined,
  TeamOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  CopyOutlined,
  ExclamationCircleOutlined,
  UserAddOutlined,
  ApartmentOutlined,
  ReloadOutlined,
  EditOutlined,
} from '@ant-design/icons';
import dayjs from 'dayjs';
import { copyText } from '../utils/clipboard';

const { Text, Title } = Typography;

/** 采购商的供应商条目 */
interface SupplierEntry {
  id: string;
  supplierName: string;
  shortName: string;
  contactPerson: string;
  contactPhone: string;
  email: string;
  // pending=待确认, approved=已合作, rejected=已拒绝, terminating=终止合作待确认, terminated=已终止
  cooperationStatus: 'pending' | 'approved' | 'rejected' | 'terminating' | 'terminated';
  addedDate: string;
  cooperationDate?: string;
  cooperationToken?: string;
  remark: string;
  purchaserCompanyId?: string;
  terminateApplyDate?: string;
  // 供应商主动发起合作标记（随 purchaser_suppliers_ 同步键跨浏览器送达；
  // cooperation_applications 不参与跨浏览器同步，跨浏览器时以该标记作为待审核依据）
  supplierInitiated?: boolean;
  supplierUsername?: string;
  supplierInitiatedDate?: string;
}

/** 合作令牌存储结构 */
interface CooperationToken {
  token: string;
  purchaserName: string;
  purchaserCompany: string;
  purchaserPhone: string;
  supplierName: string;
  supplierId: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}

const STORAGE_KEY_PREFIX = 'purchaser_suppliers_';
const TOKEN_STORAGE_KEY = 'cooperation_tokens';
const COOPERATION_APPLICATIONS_KEY = 'cooperation_applications';

// 合作申请接口（共享存储，供应商端可查看）
interface CooperationApplication {
  applicationId: string;
  purchaserUsername: string;  // 采购商登录用户名
  purchaserCompanyName: string; // 采购商公司名称
  purchaserCompanyId: string;   // 采购商填写的本公司ID
  purchaserContact: string;
  purchaserPhone: string;
  targetSupplierName: string;   // 目标供应商名称
  targetSupplierId: string;     // 目标供应商编号
  canDirectApprove: boolean;    // 是否可以直接审批
  supplierInitiated?: boolean;  // 供应商是否已主动发起合作邀请
  applyDate: string;
  status: 'pending' | 'approved' | 'rejected';
  remark: string;
  type?: 'cooperation' | 'terminate'; // 申请类型
}

const PurchaserCooperationManage: React.FC = () => {
  const username = localStorage.getItem('username') || '';
  const storageKey = STORAGE_KEY_PREFIX + username;

  const [dataSource, setDataSource] = useState<SupplierEntry[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(storageKey) || '[]');
    } catch {
      return [];
    }
  });

  const [searchText, setSearchText] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');

    // 发起合作弹窗
  const [cooperationModalVisible, setCooperationModalVisible] = useState(false);
  const [cooperationForm] = Form.useForm();
  const [currentSupplier, setCurrentSupplier] = useState<SupplierEntry | null>(null);

  // 详情弹窗
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailSupplier, setDetailSupplier] = useState<SupplierEntry | null>(null);

  // 链接弹窗
  const [linkModalVisible, setLinkModalVisible] = useState(false);
  const [generatedLink, setGeneratedLink] = useState('');

  // 编辑弹窗
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [editForm] = Form.useForm();
  const [editingSupplier, setEditingSupplier] = useState<SupplierEntry | null>(null);

  // 终止合作弹窗
  const [terminateModalVisible, setTerminateModalVisible] = useState(false);
  const [terminateSupplier, setTerminateSupplier] = useState<SupplierEntry | null>(null);

  const saveData = (data: SupplierEntry[]) => {
    setDataSource(data);
    localStorage.setItem(storageKey, JSON.stringify(data));
  };

  // 从 localStorage 重新加载数据，并同步合作/终止状态
  const reloadData = useCallback(() => {
    try {
      const data: SupplierEntry[] = JSON.parse(localStorage.getItem(storageKey) || '[]');
      const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
      let hasChange = false;
      const updated = data.map((s) => {
        // 1. 同步合作审批状态：检查 cooperation_applications 中是否有已批准的合作申请（排除已作废的）
        if (s.cooperationStatus === 'pending') {
          const approvedApp = apps.find(
            (app) => {
              if (app.purchaserUsername !== username || app.type !== 'cooperation' || app.status !== 'approved' || app.superseded) return false;
              // 优先用采购商供应商条目ID匹配（最可靠）
              if (app.purchaserSupplierEntryId && app.purchaserSupplierEntryId === s.id) return true;
              // 回退到名称和供应商ID匹配
              return app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id;
            }
          );
          if (approvedApp) {
            hasChange = true;
            return {
              ...s,
              cooperationStatus: 'approved' as const,
              cooperationDate: approvedApp.applyDate?.split(' ')[0] || dayjs().format('YYYY-MM-DD'),
              supplierName: approvedApp.targetSupplierName || s.supplierName,
              supplierInitiated: false,
            };
          }
        }
        // 2. 同步终止合作确认状态（采购商发起的终止 → 供应商已同意 → 双方已解除，排除已作废的）
        if (s.cooperationStatus === 'terminating') {
          const terminateApp = apps.find(
            (app) =>
              app.purchaserUsername === username &&
              (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id) &&
              app.type === 'terminate' &&
              app.status === 'approved' &&
              !app.superseded
          );
          if (terminateApp) {
            hasChange = true;
            return { ...s, cooperationStatus: 'terminated' as const, terminateApplyDate: undefined };
          }
        }

        // 3. 检测供应商发起的解除合作申请（approved 的供应商被供应商申请解除，排除已作废的）
        if (s.cooperationStatus === 'approved') {
          const supplierTerminateApp = apps.find(
            (app) =>
              app.purchaserUsername === username &&
              (app.targetSupplierName === s.supplierName || app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id) &&
              app.type === 'terminate' &&
              app.supplierInitiated === true &&
              app.status === 'pending' &&
              !app.superseded
          );
          if (supplierTerminateApp) {
            hasChange = true;
            return { ...s, cooperationStatus: 'terminating' as const, terminateApplyDate: supplierTerminateApp.applyDate };
          }
        }
        // 4. 供应商重新发起合作（终止/拒绝后）：回退待确认，显示同意/拒绝按键
        if (s.cooperationStatus === 'terminated' || s.cooperationStatus === 'rejected') {
          const supCoopApp = apps.find(
            (app) =>
              app.purchaserUsername === username &&
              (app.targetSupplierId === s.id || app.purchaserSupplierEntryId === s.id || app.targetSupplierName === s.supplierName) &&
              app.supplierInitiated === true &&
              (app.type || 'cooperation') === 'cooperation' &&
              app.status === 'pending' &&
              !app.superseded
          );
          if (supCoopApp) {
            hasChange = true;
            return { ...s, cooperationStatus: 'pending' as const };
          }
        }
        return s;
      });
      setDataSource(updated);
      // 只有有实际变化时才持久化，避免循环触发 StorageEvent
      if (hasChange) {
        localStorage.setItem(storageKey, JSON.stringify(updated));
      }
    } catch { /* ignore */ }
  }, [storageKey, username]);

  // 首次加载 & 跨标签页自动同步
  useEffect(() => {
    reloadData();
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === storageKey && e.newValue) {
        reloadData();
      }
      if (e.key === COOPERATION_APPLICATIONS_KEY) {
        reloadData();
      }
      // 供应商确认合作时会更新 cooperation_tokens，也触发刷新
      if (e.key === TOKEN_STORAGE_KEY) {
        reloadData();
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [reloadData]);

  // 监听页面可见性变化：当页面从后台回到前台时自动刷新
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        reloadData();
      }
    };
    const handleCoopChange = () => reloadData();
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('cooperation-applications-changed', handleCoopChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('cooperation-applications-changed', handleCoopChange);
    };
  }, [reloadData]);

  // ========== 统计 ==========
  const stats = useMemo(() => {
    const total = dataSource.length;
    const pending = dataSource.filter((s) => s.cooperationStatus === 'pending').length;
    const approved = dataSource.filter((s) => s.cooperationStatus === 'approved').length;
    const rejected = dataSource.filter((s) => s.cooperationStatus === 'rejected').length;
    const terminating = dataSource.filter((s) => s.cooperationStatus === 'terminating').length;
    const terminated = dataSource.filter((s) => s.cooperationStatus === 'terminated').length;
    return { total, pending, approved, rejected, terminating, terminated };
  }, [dataSource]);

  // ========== 生成唯一 token ==========
  const generateToken = () => {
    const ts = Date.now().toString(36);
    const rand = Math.random().toString(36).substring(2, 8);
    return `COOP-${ts}-${rand}`.toUpperCase();
  };

  // ========== 保存合作令牌 ==========
  const saveCooperationToken = (token: string, supplier: SupplierEntry) => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUser = registeredUsers.find((u: any) => u.username === username);

    const cooperationTokens: CooperationToken[] = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '[]');
    cooperationTokens.push({
      token,
      purchaserName: username,
      purchaserCompany: currentUser?.companyName || username,
      purchaserPhone: currentUser?.phone || '',
      supplierName: supplier.supplierName,
      supplierId: supplier.id,
      status: 'pending',
      createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    });
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(cooperationTokens));
  };

  // ========== 保存合作申请到共享存储 ==========
  const saveCooperationApplication = (supplier: SupplierEntry, companyId: string) => {
    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUser = registeredUsers.find((u: any) => u.username === username);

    const applications: CooperationApplication[] = JSON.parse(
      localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
    );

    const newApp: CooperationApplication = {
      applicationId: `COOP-APP-${Date.now()}`,
      purchaserUsername: username,
      purchaserCompanyName: currentUser?.companyName || companyId || username,
      purchaserCompanyId: companyId || '',
      purchaserContact: currentUser?.contactPerson || '',
      purchaserPhone: currentUser?.phone || '',
      targetSupplierName: supplier.supplierName,
      targetSupplierId: supplier.id,
      canDirectApprove: !!companyId,
      applyDate: dayjs().format('YYYY-MM-DD HH:mm:ss'),
      status: 'pending',
      remark: supplier.remark || '',
      type: 'cooperation',
    };

    // 避免重复申请
    const exists = applications.some(
      (app) =>
        app.purchaserUsername === username &&
        app.targetSupplierId === supplier.id &&
        app.status === 'pending' &&
        app.type === 'cooperation'
    );
    if (!exists) {
      applications.push(newApp);
      localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(applications));
    }
  };

  // ========== 查找供应商发起的合作申请 ==========
  const getSupplierInitiatedApp = (supplier: SupplierEntry): CooperationApplication | null => {
    const applications: CooperationApplication[] = JSON.parse(
      localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
    );
    return applications.find(
      (app) =>
        app.purchaserUsername === username &&
        app.targetSupplierId === supplier.id &&
        app.supplierInitiated === true &&
        app.status === 'pending' &&
        app.type === 'cooperation'
    ) || null;
  };

  // ========== 批准供应商发起的合作 ==========
  const handleApproveSupplierInitiated = (supplier: SupplierEntry) => {
    const app = getSupplierInitiatedApp(supplier);
    // 跨浏览器场景 cooperation_applications 不参与同步，回退以条目上的供应商发起标记为依据
    if (!app && supplier.supplierInitiated !== true) { message.error('未找到对应的合作申请'); return; }

    Modal.confirm({
      title: '确认通过合作',
      content: `供应商「${supplier.supplierName}」已主动发起合作邀请，确认通过后将建立合作关系。`,
      okText: '确认通过',
      cancelText: '取消',
      onOk: () => {
        const updatedSuppliers = dataSource.map((s) =>
          s.id === supplier.id
            ? { ...s, cooperationStatus: 'approved' as const, cooperationDate: dayjs().format('YYYY-MM-DD'), supplierInitiated: false }
            : s
        );
        saveData(updatedSuppliers);

        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updatedApps = apps.map((a) =>
          a.applicationId === app?.applicationId
            ? { ...a, status: 'approved' as const }
            : a
        );
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updatedApps));

        // 申请记录缺失（跨浏览器）时回退用当前登录账号的采购商信息
        const registeredUsers: any[] = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
        const currentUser = registeredUsers.find((u: any) => u.username === username);
        const purchaserCompanyName = app?.purchaserCompanyName || currentUser?.companyName || username;
        const purchaserContact = app?.purchaserContact || currentUser?.contactPerson || '';
        const purchaserPhone = app?.purchaserPhone || currentUser?.phone || '';

        // 同步到供应商端客户列表（boundPurchasers），建立合作后供应商列表自动显示
        let supUser = (app as any)?.supplierUsername || supplier.supplierUsername || '';
        if (!supUser) {
          // 申请记录未携带供应商账号时，按供应商公司名称反查注册账号
          try {
            const su = registeredUsers.find((u: any) => (u.companyName || '') === (app?.targetSupplierName || supplier.supplierName));
            if (su) supUser = su.username || '';
          } catch { /* ignore */ }
        }
        if (supUser) {
          const boundKey = 'boundPurchasers_' + supUser;
          try {
            const bound: any[] = JSON.parse(localStorage.getItem(boundKey) || '[]');
            const existIdx = bound.findIndex((bp: any) => bp.purchaserName === purchaserCompanyName || bp.purchaserUsername === username);
            if (existIdx >= 0) {
              // 曾终止合作后重新合作：回退已合作并刷新绑定日期
              bound[existIdx] = { ...bound[existIdx], status: 'approved', bindDate: dayjs().format('YYYY-MM-DD') };
              localStorage.setItem(boundKey, JSON.stringify(bound));
            } else {
              bound.unshift({
                key: `bp-${Date.now()}`,
                id: `BIND-${Date.now()}`,
                purchaserName: purchaserCompanyName,
                purchaserContact,
                purchaserPhone,
                bindDate: dayjs().format('YYYY-MM-DD'),
                status: 'approved',
                purchaserUsername: username,
              });
              localStorage.setItem(boundKey, JSON.stringify(bound));
            }
          } catch { /* ignore */ }
        }
        window.dispatchEvent(new Event('cooperation-applications-changed'));

        message.success(`已通过「${supplier.supplierName}」的合作，合作关系已建立`);
      },
    });
  };

  // ========== 拒绝供应商发起的合作 ==========
  const handleRejectSupplierInitiated = (supplier: SupplierEntry) => {
    const app = getSupplierInitiatedApp(supplier);
    // 跨浏览器场景 cooperation_applications 不参与同步，回退以条目上的供应商发起标记为依据
    if (!app && supplier.supplierInitiated !== true) { message.error('未找到对应的合作申请'); return; }

    Modal.confirm({
      title: '确认拒绝合作',
      content: `确定拒绝供应商「${supplier.supplierName}」发起的合作邀请吗？`,
      okText: '确认拒绝',
      okType: 'danger',
      cancelText: '取消',
      onOk: () => {
        const updatedSuppliers = dataSource.map((s) =>
          s.id === supplier.id
            ? { ...s, cooperationStatus: 'rejected' as const, cooperationDate: dayjs().format('YYYY-MM-DD'), supplierInitiated: false }
            : s
        );
        saveData(updatedSuppliers);

        const apps: CooperationApplication[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updatedApps = apps.map((a) =>
          a.applicationId === app?.applicationId
            ? { ...a, status: 'rejected' as const }
            : a
        );
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updatedApps));

        message.warning(`已拒绝「${supplier.supplierName}」的合作邀请`);
      },
    });
  };

  // ========== 编辑供应商 ==========
  const handleEditSupplier = () => {
    editForm.validateFields().then((values) => {
      if (!editingSupplier) return;
      const updated = dataSource.map((s) =>
        s.id === editingSupplier.id
          ? {
              ...s,
              supplierName: values.supplierName,
              shortName: values.shortName || '',
              contactPerson: values.contactPerson || '',
              contactPhone: values.contactPhone || '',
              email: values.email || '',
              remark: values.remark || '',
            }
          : s
      );
      saveData(updated);
      setEditModalVisible(false);
      editForm.resetFields();
      setEditingSupplier(null);
      message.success('供应商信息已更新');
    });
  };

  // 打开编辑弹窗
  const openEditModal = (supplier: SupplierEntry) => {
    setEditingSupplier(supplier);
    editForm.setFieldsValue({
      supplierName: supplier.supplierName,
      shortName: supplier.shortName,
      contactPerson: supplier.contactPerson,
      contactPhone: supplier.contactPhone,
      email: supplier.email,
      remark: supplier.remark,
    });
    setEditModalVisible(true);
  };

    // ========== 打开发起合作弹窗（生成邀约链接）==========
  const openCooperationModal = (supplier: SupplierEntry) => {
    setCurrentSupplier(supplier);
    cooperationForm.setFieldsValue({
      supplierName: supplier.supplierName,
    });
    setCooperationModalVisible(true);
  };

  // ========== 发起合作（生成链接，不自动创建合作申请）==========
  const handleInitiateCooperation = () => {
    cooperationForm.validateFields().then((values) => {
      if (!currentSupplier) return;
      
      const token = generateToken();
      const username = localStorage.getItem('username') || '';
      const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
      const currentUser = registeredUsers.find((u: any) => u.username === username);
      const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

      const updated = dataSource.map((s) => {
        if (s.id === currentSupplier.id) {
          return {
            ...s,
            supplierName: values.supplierName,
            cooperationStatus: 'pending' as const,
            cooperationToken: token,
          };
        }
        return s;
      });
      saveData(updated);

      // 保存 token 到 cooperation_tokens，供应商确认页面需要读取
      const cooperationTokens: any[] = JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '[]');
      cooperationTokens.push({
        token,
        purchaserName: username,
        purchaserCompany: currentUser?.companyName || username,
        purchaserPhone: currentUser?.phone || '',
        supplierName: values.supplierName,
        supplierId: currentSupplier.id,
        purchaserSupplierEntryId: currentSupplier.id,
        status: 'pending',
        createdAt: now,
      });
      localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(cooperationTokens));

      // 闭环：同步生成合作申请到供应商端「合作申请」（终止/拒绝后重新申请，对方可直接通过/拒绝）
      const apps0: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
      apps0.forEach((a: any) => {
        if (
          a.purchaserUsername === username &&
          (a.targetSupplierName === values.supplierName || a.targetSupplierId === currentSupplier.id || a.purchaserSupplierEntryId === currentSupplier.id) &&
          (a.type || 'cooperation') === 'cooperation' &&
          a.status === 'approved'
        ) {
          a.superseded = true;
        }
      });
      apps0.push({
        applicationId: `COOP-REINIT-${Date.now()}`,
        purchaserUsername: username,
        purchaserCompanyName: currentUser?.companyName || username,
        purchaserCompanyId: '',
        purchaserContact: currentUser?.contactPerson || '',
        purchaserPhone: currentUser?.phone || '',
        targetSupplierName: values.supplierName,
        targetSupplierId: currentSupplier.id,
        purchaserSupplierEntryId: currentSupplier.id,
        canDirectApprove: false,
        applyDate: now,
        status: 'pending',
        remark: `采购商「${currentUser?.companyName || username}」申请（重新）建立合作`,
        type: 'cooperation',
        supplierInitiated: false,
      });
      localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps0));
      window.dispatchEvent(new Event('cooperation-applications-changed'));

      const link = `${window.location.origin}/cooperation-confirm/${token}`;
      setGeneratedLink(link);
      setCooperationModalVisible(false);
      setLinkModalVisible(true);
      cooperationForm.resetFields();

      message.success('合作邀请链接已生成，请发送给供应商');
    });
  };

  // ========== 仅生成合作链接 ==========
  const openLinkModal = (supplier: SupplierEntry) => {
    const token =
      supplier.cooperationToken ||
      (() => {
        const t = generateToken();
        const updated = dataSource.map((s) => {
          if (s.id === supplier.id) return { ...s, cooperationToken: t };
          return s;
        });
        saveData(updated);
        saveCooperationToken(t, supplier);
        return t;
      })();

    const link = `${window.location.origin}/supplier-cooperation-confirm/${token}`;
    setGeneratedLink(link);
    setLinkModalVisible(true);
  };

  // ========== 复制链接 ==========
  const copyLink = () => {
    if (!generatedLink) return;
    copyText(generatedLink).then(ok => (ok
      ? message.success('链接已复制到剪贴板')
      : message.error('复制失败，请手动复制')));
  };

  // ========== 发起终止合作申请（需供应商确认）==========
  const handleTerminateApply = (supplier: SupplierEntry) => {
    setTerminateSupplier(supplier);
    setTerminateModalVisible(true);
  };

  const confirmTerminate = () => {
    if (!terminateSupplier) return;

    const now = dayjs().format('YYYY-MM-DD HH:mm:ss');

    const registeredUsers = JSON.parse(localStorage.getItem('registeredUsers') || '[]');
    const currentUser = registeredUsers.find((u: any) => u.username === username);

    const apps: CooperationApplication[] = JSON.parse(
      localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
    );

    // 作废旧的终止申请，避免 reloadData 误匹配
    apps.forEach((app: any) => {
      if (
        app.purchaserUsername === username &&
        (app.targetSupplierName === terminateSupplier.supplierName || app.targetSupplierId === terminateSupplier.id || app.purchaserSupplierEntryId === terminateSupplier.id) &&
        app.type === 'terminate' &&
        app.status === 'approved'
      ) {
        (app as any).superseded = true;
      }
    });

    // 避免重复申请
    const exists = apps.some(
      (app) =>
        app.purchaserUsername === username &&
        app.targetSupplierName === terminateSupplier.supplierName &&
        app.status === 'pending' &&
        app.type === 'terminate'
    );
    if (exists) {
      message.warning('已向该供应商发起终止合作申请，请等待确认');
      setTerminateModalVisible(false);
      return;
    }

    const newApp: CooperationApplication = {
      applicationId: `TERM-${Date.now()}`,
      purchaserUsername: username,
      purchaserCompanyName: currentUser?.companyName || username,
      purchaserCompanyId: '',
      purchaserContact: currentUser?.contactPerson || '',
      purchaserPhone: currentUser?.phone || '',
      targetSupplierName: terminateSupplier.supplierName,
      targetSupplierId: terminateSupplier.id,
      canDirectApprove: false,
      applyDate: now,
      status: 'pending',
      remark: `采购商「${currentUser?.companyName || username}」申请终止与供应商「${terminateSupplier.supplierName}」的合作`,
      type: 'terminate',
    };

    apps.push(newApp);
    localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(apps));

    // 更新本地状态为"终止合作待确认"
    const updated = dataSource.map((s) =>
      s.id === terminateSupplier.id
        ? { ...s, cooperationStatus: 'terminating' as const, terminateApplyDate: now }
        : s
    );
    saveData(updated);

    setTerminateModalVisible(false);
    setTerminateSupplier(null);
    message.success(`终止合作申请已发送给供应商「${terminateSupplier.supplierName}」，等待供应商确认`);
  };

  // ========== 同意供应商发起的解除合作 ==========
  const handleApproveTerminate = (supplier: SupplierEntry) => {
    Modal.confirm({
      title: '确认解除合作',
      content: `确定同意解除与供应商「${supplier.supplierName}」的合作关系吗？解除后双方合作关系将终止。`,
      okText: '确认解除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        // 1. 更新 cooperation_applications 中的解除申请为 approved
        const apps: any[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updatedApps = apps.map((app) => {
          if (
            app.purchaserUsername === username &&
            (app.targetSupplierName === supplier.supplierName || app.targetSupplierId === supplier.id) &&
            app.type === 'terminate' &&
            app.supplierInitiated === true &&
            app.status === 'pending'
          ) {
            return { ...app, status: 'approved' };
          }
          return app;
        });
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updatedApps));

        // 2. 更新采购商侧供应商列表状态为已终止
        const updated = dataSource.map((s) =>
          s.id === supplier.id
            ? { ...s, cooperationStatus: 'terminated' as const, terminateApplyDate: undefined }
            : s
        );
        saveData(updated);

        // 3. 更新供应商侧客户列表状态为已终止
        const terminateApp = updatedApps.find(
          (app) =>
            app.purchaserUsername === username &&
            app.targetSupplierName === supplier.supplierName &&
            app.type === 'terminate' &&
            app.supplierInitiated === true &&
            app.status === 'approved'
        );
        if (terminateApp?.targetSupplierId) {
          const supplierBoundKey = 'boundPurchasers_' + terminateApp.targetSupplierId;
          try {
            const boundData: any[] = JSON.parse(localStorage.getItem(supplierBoundKey) || '[]');
            const updatedBound = boundData.map((bp) =>
              bp.purchaserName === terminateApp.purchaserCompanyName
                ? { ...bp, status: 'terminated' }
                : bp
            );
            localStorage.setItem(supplierBoundKey, JSON.stringify(updatedBound));
          } catch { /* ignore */ }
        }

        // 4. 通知供应商侧刷新
        window.dispatchEvent(new Event('supplier-unbind-success'));
        message.success(`已同意解除与供应商「${supplier.supplierName}」的合作关系`);
      },
    });
  };

  // ========== 拒绝供应商发起的解除合作 ==========
  const handleRejectTerminate = (supplier: SupplierEntry) => {
    Modal.confirm({
      title: '拒绝解除合作',
      content: `确定拒绝供应商「${supplier.supplierName}」的解除合作申请吗？拒绝后双方恢复为已合作状态。`,
      okText: '确认拒绝',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: () => {
        // 1. 解除申请置 rejected
        const apps: any[] = JSON.parse(
          localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]'
        );
        const updatedApps = apps.map((app: any) => {
          if (
            app.purchaserUsername === username &&
            (app.targetSupplierName === supplier.supplierName || app.targetSupplierId === supplier.id || app.purchaserSupplierEntryId === supplier.id) &&
            app.type === 'terminate' &&
            app.supplierInitiated === true &&
            app.status === 'pending'
          ) {
            return { ...app, status: 'rejected' };
          }
          return app;
        });
        localStorage.setItem(COOPERATION_APPLICATIONS_KEY, JSON.stringify(updatedApps));

        // 2. 采购商侧供应商条目回退已合作
        const updated = dataSource.map((s) =>
          s.id === supplier.id
            ? { ...s, cooperationStatus: 'approved' as const, terminateApplyDate: undefined }
            : s
        );
        saveData(updated);

        // 3. 供应商侧客户列表（boundPurchasers）解除申请中 → 已合作
        const rejectApp = updatedApps.find(
          (app: any) =>
            app.purchaserUsername === username &&
            app.targetSupplierName === supplier.supplierName &&
            app.type === 'terminate' &&
            app.supplierInitiated === true &&
            app.status === 'rejected'
        );
        if (rejectApp?.targetSupplierId) {
          const supplierBoundKey = 'boundPurchasers_' + rejectApp.targetSupplierId;
          try {
            const boundData: any[] = JSON.parse(localStorage.getItem(supplierBoundKey) || '[]');
            const updatedBound = boundData.map((bp: any) =>
              bp.purchaserName === rejectApp.purchaserCompanyName && bp.status === 'terminating'
                ? { ...bp, status: 'approved' }
                : bp
            );
            localStorage.setItem(supplierBoundKey, JSON.stringify(updatedBound));
          } catch { /* ignore */ }
        }

        // 4. 通知供应商侧刷新
        window.dispatchEvent(new Event('supplier-unbind-success'));
        window.dispatchEvent(new Event('cooperation-applications-changed'));
        message.warning(`已拒绝供应商「${supplier.supplierName}」的解除合作申请，双方恢复为已合作`);
      },
    });
  };

  // ========== 删除供应商 ==========
  const handleDeleteSupplier = (record: SupplierEntry) => {
    const updated = dataSource.filter((s) => s.id !== record.id);
    saveData(updated);
    message.success(`供应商「${record.supplierName}」已删除`);
  };

  // ========== 查看详情 ==========
  const handleViewDetail = (record: SupplierEntry) => {
    setDetailSupplier(record);
    setDetailVisible(true);
  };

  // ========== 表格列定义 ==========
  const columns: any[] = [
    {
      title: '供应商编号',
      dataIndex: 'id',
      key: 'id',
      width: 130,
    },
    {
      title: '供应商名称',
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 200,
      render: (text: string, record: SupplierEntry) => (
        <a onClick={() => handleViewDetail(record)}>{text}</a>
      ),
    },
    {
      title: '简称',
      dataIndex: 'shortName',
      key: 'shortName',
      width: 120,
    },
    {
      title: '联系人',
      dataIndex: 'contactPerson',
      key: 'contactPerson',
      width: 100,
    },
    {
      title: '联系电话',
      dataIndex: 'contactPhone',
      key: 'contactPhone',
      width: 130,
    },
    {
      title: '合作状态',
      dataIndex: 'cooperationStatus',
      key: 'cooperationStatus',
      width: 140,
      render: (status: string) => {
        const map: Record<string, { color: string; text: string; icon: any }> = {
          pending: { color: 'processing', text: '待确认', icon: <ClockCircleOutlined /> },
          approved: { color: 'success', text: '已合作', icon: <CheckCircleOutlined /> },
          rejected: { color: 'error', text: '已拒绝', icon: <CloseCircleOutlined /> },
          terminating: { color: 'warning', text: '终止待确认', icon: <ExclamationCircleOutlined /> },
          terminated: { color: 'default', text: '已解除合作', icon: <ClockCircleOutlined /> },
        };
        const conf = map[status] || map.pending;
        return (
          <Tag icon={conf.icon} color={conf.color}>
            {conf.text}
          </Tag>
        );
      },
    },
    {
      title: '添加日期',
      dataIndex: 'addedDate',
      key: 'addedDate',
      width: 160,
    },
    {
      title: '合作日期',
      dataIndex: 'cooperationDate',
      key: 'cooperationDate',
      width: 120,
      render: (text: string) => text || '-',
    },
    {
      title: '操作',
      key: 'action',
      width: 300,
      fixed: 'right',
      render: (_: any, record: SupplierEntry) => (
        <Space size="small" wrap>
          <Button type="link" size="small" onClick={() => handleViewDetail(record)}>
            查看
          </Button>
          <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            编辑
          </Button>
          
          {/* 待确认的供应商：供应商主动发起的合作申请（含跨浏览器仅同步到条目标记）显示同意/拒绝，否则可发起合作 */}
          {record.cooperationStatus === 'pending' && ((getSupplierInitiatedApp(record) || record.supplierInitiated === true) ? (
            <>
              <Button
                type="link"
                size="small"
                style={{ color: '#52c41a' }}
                icon={<CheckCircleOutlined />}
                onClick={() => handleApproveSupplierInitiated(record)}
              >
                同意合作
              </Button>
              <Button
                type="link"
                size="small"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => handleRejectSupplierInitiated(record)}
              >
                拒绝
              </Button>
            </>
          ) : (
            <Button
              type="link"
              size="small"
              style={{ color: '#1890ff' }}
              icon={<LinkOutlined />}
              onClick={() => openCooperationModal(record)}
            >
              发起合作
            </Button>
          ))}
          
          {/* 已合作的供应商：可以终止合作 */}
          {record.cooperationStatus === 'approved' && (
            <Button
              type="link"
              size="small"
              danger
              icon={<CloseCircleOutlined />}
              onClick={() => handleTerminateApply(record)}
            >
              终止合作
            </Button>
          )}
          
          {/* 终止待确认的供应商：显示状态 + 如果是供应商发起的解除则显示同意按钮 */}
          {record.cooperationStatus === 'terminating' && (() => {
            // 检查是否有供应商发起的解除申请
            const apps: any[] = JSON.parse(localStorage.getItem(COOPERATION_APPLICATIONS_KEY) || '[]');
            const supplierInitiated = apps.some(
              (app) =>
                app.purchaserUsername === username &&
                (app.targetSupplierName === record.supplierName || app.targetSupplierId === record.id) &&
                app.type === 'terminate' &&
                app.supplierInitiated === true &&
                app.status === 'pending'
            );
            return supplierInitiated ? (
              <>
                <Tag color="warning">供应商申请解除合作</Tag>
                <Button
                  type="link"
                  size="small"
                  danger
                  icon={<CheckCircleOutlined />}
                  onClick={() => handleApproveTerminate(record)}
                >
                  同意解除
                </Button>
                <Button
                  type="link"
                  size="small"
                  icon={<CloseCircleOutlined />}
                  onClick={() => handleRejectTerminate(record)}
                >
                  拒绝解除
                </Button>
              </>
            ) : (
              <Tag color="warning">等待供应商确认终止</Tag>
            );
          })()}
          
          {/* 待合作的供应商（终止后可重新发起）：可以重新发起合作 */}
          {record.cooperationStatus === 'terminated' && (
            <Button
              type="link"
              size="small"
              style={{ color: '#1890ff' }}
              icon={<LinkOutlined />}
              onClick={() => openCooperationModal(record)}
            >
              重新合作
            </Button>
          )}
          
          {/* 已合作的供应商：不能删除，只能终止合作 */}
          {record.cooperationStatus !== 'approved' && record.cooperationStatus !== 'terminating' && (
            <Popconfirm
              title="确定删除该供应商？"
              description="删除后该供应商将从列表中移除"
              onConfirm={() => handleDeleteSupplier(record)}
              okText="确定"
              cancelText="取消"
            >
              <Button type="link" size="small" danger>
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  // ========== 筛选数据 ==========
  const filteredData = useMemo(() => {
    let result = dataSource;
    
    if (statusFilter) {
      result = result.filter((s) => s.cooperationStatus === statusFilter);
    }
    
    if (searchText) {
      result = result.filter(
        (s) =>
          s.supplierName.includes(searchText) ||
          s.shortName.includes(searchText) ||
          s.contactPerson.includes(searchText)
      );
    }
    
    return result;
  }, [dataSource, statusFilter, searchText]);

  // ========== 快速筛选标签 ==========
  const tabItems = [
    { key: '', label: `全部 (${stats.total})` },
    { key: 'pending', label: `待确认 (${stats.pending})` },
    { key: 'approved', label: `已合作 (${stats.approved})` },
    { key: 'terminating', label: `终止待确认 (${stats.terminating})` },
    { key: 'terminated', label: `已解除合作 (${stats.terminated})` },
    { key: 'rejected', label: `已拒绝 (${stats.rejected})` },
  ];

  return (
    <div style={{ padding: '24px', background: '#f0f2f5', minHeight: '100vh' }}>
      {/* 页面标题 */}
      <Title level={4} style={{ marginBottom: 24 }}>
        <TeamOutlined style={{ marginRight: 8 }} />
        供应商管理（合作管理）
      </Title>

      {/* 统计卡片 */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col span={4}>
          <Card size="small" hoverable>
            <Statistic title="供应商总数" value={stats.total} prefix={<TeamOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" hoverable>
            <Statistic title="待确认" value={stats.pending} valueStyle={{ color: '#1890ff' }} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" hoverable>
            <Statistic title="已合作" value={stats.approved} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" hoverable>
            <Statistic title="已拒绝" value={stats.rejected} valueStyle={{ color: '#ff4d4f' }} prefix={<CloseCircleOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" hoverable>
            <Statistic title="终止待确认" value={stats.terminating} valueStyle={{ color: '#faad14' }} prefix={<ExclamationCircleOutlined />} />
          </Card>
        </Col>
        <Col span={4}>
          <Card size="small" hoverable>
            <Statistic title="已解除合作" value={stats.terminated} valueStyle={{ color: '#999' }} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      {/* 筛选区域 */}
      <Card bodyStyle={{ padding: '0' }} style={{ marginBottom: 16 }}>
        <div style={{ padding: '12px 24px 0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Input
            placeholder="搜索供应商名称、联系人"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            allowClear
            style={{ width: 260 }}
          />
          <Space>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                reloadData();
                message.success('已刷新供应商列表');
              }}
            >
              刷新
            </Button>
          </Space>
        </div>
        <Tabs
          activeKey={statusFilter}
          onChange={setStatusFilter}
          items={tabItems}
          size="small"
          style={{ padding: '0 24px', marginBottom: 0 }}
        />
      </Card>

      {/* 数据表格 */}
      <Card bodyStyle={{ padding: '0 24px 24px' }}>
        <Table
          columns={columns}
          dataSource={filteredData}
          rowKey="id"
          scroll={{ x: 1400 }}
          size="middle"
          pagination={{
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `第 ${range[0]}-${range[1]} 条，共 ${total} 条`,
            pageSizeOptions: ['10', '20', '50'],
            defaultPageSize: 20,
          }}
          locale={{ emptyText: '暂无供应商数据' }}
        />
      </Card>

      {/* 发起合作弹窗 */}
      <Modal
        title={<span><LinkOutlined style={{ marginRight: 8, color: '#1890ff' }} />发起合作</span>}
        open={cooperationModalVisible}
        onCancel={() => { setCooperationModalVisible(false); cooperationForm.resetFields(); }}
        onOk={handleInitiateCooperation}
        okText="确认发起"
        cancelText="取消"
        width={520}
      >
        <Form autoComplete="off" form={cooperationForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="supplierName"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="请输入供应商企业名称" />
          </Form.Item>
          <Form.Item name="purchaserCompanyId" label="采购商公司ID">
            <Input placeholder="填写后供应商可直接审批" />
          </Form.Item>
          <div
            style={{
              padding: '12px 16px',
              background: '#e6f7ff',
              border: '1px solid #91d5ff',
              borderRadius: 6,
              marginTop: 8,
            }}
          >
            <ExclamationCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />
            发起合作后，系统将生成合作邀请链接，请将链接发送给供应商。供应商打开链接确认后，合作关系即可建立。
          </div>
        </Form>
      </Modal>

      {/* 合作链接弹窗 */}
      <Modal
        title={
          <Space>
            <LinkOutlined style={{ color: '#1890ff' }} />
            <span>合作邀请链接</span>
          </Space>
        }
        open={linkModalVisible}
        onCancel={() => setLinkModalVisible(false)}
        footer={[
          <Button key="close" onClick={() => setLinkModalVisible(false)}>
            关闭
          </Button>,
          <Button
            key="copy"
            type="primary"
            icon={<CopyOutlined />}
            onClick={copyLink}
            style={{
              border: 'none',
              background: 'linear-gradient(135deg, #1890ff 0%, #096dd9 100%)',
            }}
          >
            复制链接
          </Button>,
        ]}
        width={560}
      >
        <div
          style={{
            padding: '12px 16px',
            background: '#e6f7ff',
            border: '1px solid #91d5ff',
            borderRadius: 6,
            marginBottom: 16,
            marginTop: 8,
          }}
        >
          <ExclamationCircleOutlined style={{ color: '#1890ff', marginRight: 8 }} />
          请将此链接发送给供应商 <strong>{currentSupplier?.supplierName}</strong>，
          供应商打开链接确认后即可建立双方的合作关系。
        </div>
        <div
          style={{
            padding: '16px 20px',
            background: '#fafafa',
            border: '1px solid #d9d9d9',
            borderRadius: 8,
            wordBreak: 'break-all',
            fontSize: 13,
            fontFamily: 'monospace',
            color: '#1890ff',
          }}
        >
          {generatedLink}
        </div>
      </Modal>

      {/* 编辑供应商弹窗 */}
      <Modal
        title={<span><EditOutlined style={{ marginRight: 8 }} />编辑供应商</span>}
        open={editModalVisible}
        onCancel={() => { setEditModalVisible(false); editForm.resetFields(); setEditingSupplier(null); }}
        onOk={handleEditSupplier}
        okText="保存修改"
        cancelText="取消"
        width={520}
      >
        <Form autoComplete="off" form={editForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="supplierName"
            label="供应商名称"
            rules={[{ required: true, message: '请输入供应商名称' }]}
          >
            <Input placeholder="请输入供应商企业名称" />
          </Form.Item>
          <Form.Item name="shortName" label="简称">
            <Input placeholder="供应商简称（选填）" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="contactPerson" label="联系人">
                <Input placeholder="联系人姓名" />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="contactPhone" label="联系电话">
                <Input placeholder="联系电话" />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="email" label="邮箱">
            <Input placeholder="电子邮箱" />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={3} placeholder="备注信息（选填）" />
          </Form.Item>
        </Form>
      </Modal>

      {/* 终止合作确认弹窗 */}
      <Modal
        title={<span><CloseCircleOutlined style={{ marginRight: 8, color: '#ff4d4f' }} />终止合作</span>}
        open={terminateModalVisible}
        onCancel={() => { setTerminateModalVisible(false); setTerminateSupplier(null); }}
        onOk={confirmTerminate}
        okText="确认终止"
        okType="danger"
        cancelText="取消"
      >
        <div
          style={{
            padding: '12px 16px',
            background: '#fff2e8',
            border: '1px solid #ffbb96',
            borderRadius: 6,
            marginBottom: 16,
            marginTop: 8,
          }}
        >
          <ExclamationCircleOutlined style={{ color: '#ff4d4f', marginRight: 8 }} />
          确定要终止与供应商 <strong>{terminateSupplier?.supplierName}</strong> 的合作吗？
          <br />
          终止合作后，供应商将在合作申请中接收相关信息，供应商同意后，双方的合作状态将改为"待合作"。
        </div>
      </Modal>

      {/* 详情弹窗 */}
      <Modal
        title={<span><TeamOutlined style={{ marginRight: 8 }} />供应商详情</span>}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={[
          <Button key="close" onClick={() => setDetailVisible(false)}>
            关闭
          </Button>,
        ]}
        width={600}
      >
        {detailSupplier && (
          <Descriptions column={2} bordered size="small">
            <Descriptions.Item label="供应商编号">{detailSupplier.id}</Descriptions.Item>
            <Descriptions.Item label="供应商名称">{detailSupplier.supplierName}</Descriptions.Item>
            <Descriptions.Item label="简称">{detailSupplier.shortName || '-'}</Descriptions.Item>
            <Descriptions.Item label="合作状态">
              <Tag color={
                detailSupplier.cooperationStatus === 'approved' ? 'success' :
                detailSupplier.cooperationStatus === 'pending' ? 'processing' :
                detailSupplier.cooperationStatus === 'rejected' ? 'error' :
                detailSupplier.cooperationStatus === 'terminating' ? 'warning' : 'default'
              }>
                {detailSupplier.cooperationStatus === 'approved' ? '已合作' :
                 detailSupplier.cooperationStatus === 'pending' ? '待确认' :
                 detailSupplier.cooperationStatus === 'rejected' ? '已拒绝' :
                 detailSupplier.cooperationStatus === 'terminating' ? '终止待确认' : '待合作'}
              </Tag>
            </Descriptions.Item>
            <Descriptions.Item label="联系人">{detailSupplier.contactPerson || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{detailSupplier.contactPhone || '-'}</Descriptions.Item>
            <Descriptions.Item label="邮箱" span={2}>{detailSupplier.email || '-'}</Descriptions.Item>
            <Descriptions.Item label="添加日期" span={2}>{detailSupplier.addedDate}</Descriptions.Item>
            {detailSupplier.cooperationDate && (
              <Descriptions.Item label="合作日期" span={2}>{detailSupplier.cooperationDate}</Descriptions.Item>
            )}
            {detailSupplier.terminateApplyDate && (
              <Descriptions.Item label="终止申请日期" span={2}>{detailSupplier.terminateApplyDate}</Descriptions.Item>
            )}
            <Descriptions.Item label="备注" span={2}>{detailSupplier.remark || '-'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </div>
  );
};

export default PurchaserCooperationManage;
