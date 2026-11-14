/**
 * 按需打包的图表组件：仅引入 echarts/core + 柱状/环形图及其必需组件，
 * 替代整包 echarts-for-react（整包约 1.4MB，按需约 300KB，gzip 后约 100KB）。
 * 页面侧配合 React.lazy 使用：图表 chunk 在首屏之后并行下载，不阻塞指标卡与表格的首帧。
 */
import React from 'react';
import * as echarts from 'echarts/core';
import { BarChart, PieChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent, LegendComponent, TitleComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import ReactEChartsCore from 'echarts-for-react/lib/core';

echarts.use([BarChart, PieChart, LineChart, GridComponent, TooltipComponent, LegendComponent, TitleComponent, CanvasRenderer]);

const EChartsLite: React.FC<{
  option: any;
  style?: React.CSSProperties;
  notMerge?: boolean;
  lazyUpdate?: boolean;
}> = ({ option, style, notMerge, lazyUpdate }) => (
  <ReactEChartsCore echarts={echarts} option={option} style={style} notMerge={notMerge} lazyUpdate={lazyUpdate} />
);

export default EChartsLite;
