import React from 'react';
import GeneralLedgerPage from './GeneralLedgerPage';

// 简易账薄：复用会计账薄页面骨架（日常记账 | 科目表 | 科目汇总），
// 其中首栏以日常记账替换会计分录
const SimpleLedgerPage: React.FC = () => <GeneralLedgerPage simple />;

export default SimpleLedgerPage;
