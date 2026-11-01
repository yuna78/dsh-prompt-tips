# 从源码安装 / 卸载 / 排错

## 从源码安装（开发模式）

```bash
# 在 dsh-prompt-tips 目录
dsh plugin --profile web add /absolute/path/to/dsh-prompt-tips
```

装完重启 `dsh web` 进程并刷新页面。

## 验证

```bash
npm test          # smoke(25) + contract(6) + host(10) 共 41 项
npm run validate:resources   # 校验 resources/index.json
```

## 排错

| 现象 | 处理 |
|---|---|
| 右下角没有小精灵 | 确认装的是 web profile；Ctrl+C 停掉 `dsh web` 再重新 `dsh web` 后刷新 |
| 气泡显示「离线理由」 | 正常降级：模型不可用（无凭据/超时/输出异常）。打开 Web 的 Models 页保存可用 API Key，下一轮自动恢复「个性化」 |
| 提示 PATH 里没有 dsh | 插件配置里把 `dshBin` 指到 dsh 的绝对路径 |
| 点同步失败 | 看错误原因：请求超时（网络 / CDN 缓存未过 5 分钟）或远端数据被校验拒绝（版本内容异常）；本周仓库侧问题会在 research-log 里记录 |
| 资源库为空报错 | `npm run validate:resources` 检查内置库；或先点一次「同步」拉取远端库 |
| 素材 404 | `assets/skins/<皮肤目录>/` 的 SVG 缺失；换肤到存在的一套 |

## 数据位置

- 状态快照：`$DSH_HOME/storages/dsh-prompt-tips.json`
- 同步来的资源库：`$DSH_HOME/storages/dsh-prompt-tips.resources.json`
  （删掉它即回落内置版本）
- 模型桥接 overlay：`$DSH_HOME/storages/dsh-prompt-tips.headless-overlay.yml`
  （自动生成，可安全删除）

两个位置都可用 env 覆盖：`DSH_PROMPT_TIPS_STATE`、`DSH_PROMPT_TIPS_RESOURCES`。
