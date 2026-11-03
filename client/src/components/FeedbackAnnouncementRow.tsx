import React from 'react';
import { Row, Col } from 'antd';
import FeedbackPanel from './FeedbackPanel';
import AnnouncementPanel from './AnnouncementPanel';

/**
 * 首页底部组合区：左「意见反馈」提交面板（约1/3宽）+ 右「公告模板」（开发者后台可编辑，约2/3宽）；
 * 供应商首页与采购商首页共用。
 */
const FeedbackAnnouncementRow: React.FC = () => (
  <Row gutter={[12, 12]} style={{ marginTop: 16, alignItems: 'stretch' }}>
    <Col xs={24} lg={8}>
      <FeedbackPanel />
    </Col>
    <Col xs={24} lg={16}>
      <AnnouncementPanel />
    </Col>
  </Row>
);

export default FeedbackAnnouncementRow;
