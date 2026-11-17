'use client';

import { Plus, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';

import {
  loadUserSources,
  MAX_SOURCE_NAME_LEN,
  MAX_USER_SOURCES,
  parseApiSiteJson,
  sanitizeUserSources,
  saveUserSources,
  toApiSiteMap,
  UserSource,
  validateSourceUrl,
} from '@/lib/userSources';

interface SourceManagerProps {
  onClose: () => void;
}

const inputClass =
  'w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500';

type Notice = { kind: 'ok' | 'error'; text: string } | null;

export const SourceManager: React.FC<SourceManagerProps> = ({ onClose }) => {
  const [sources, setSources] = useState<UserSource[]>([]);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const [name, setName] = useState('');
  const [api, setApi] = useState('');
  const [detail, setDetail] = useState('');

  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState('');

  useEffect(() => {
    setSources(loadUserSources());
  }, []);

  const update = (next: UserSource[]) => {
    setSources(next);
    setDirty(true);
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNotice({ kind: 'error', text: '请填写名称' });
      return;
    }
    const apiError = validateSourceUrl(api);
    if (apiError) {
      setNotice({ kind: 'error', text: `接口${apiError}` });
      return;
    }
    if (detail.trim()) {
      const detailError = validateSourceUrl(detail);
      if (detailError) {
        setNotice({ kind: 'error', text: `详情${detailError}` });
        return;
      }
    }
    if (sources.length >= MAX_USER_SOURCES) {
      setNotice({
        kind: 'error',
        text: `最多添加 ${MAX_USER_SOURCES} 个播放源`,
      });
      return;
    }
    if (sources.some((s) => s.api === api.trim())) {
      setNotice({ kind: 'error', text: '这个接口地址已经在列表里了' });
      return;
    }

    const { sources: cleaned, errors } = sanitizeUserSources([
      ...sources,
      { name: trimmedName, api, detail },
    ]);
    if (errors.length > 0) {
      setNotice({ kind: 'error', text: errors[0] });
      return;
    }
    update(cleaned);
    setName('');
    setApi('');
    setDetail('');
    setNotice({
      kind: 'ok',
      text: '已加入列表，点「保存并应用」后生效',
    });
  };

  const handleToggle = (key: string) => {
    update(
      sources.map((s) => {
        if (s.key !== key) return s;
        const next: UserSource = { ...s };
        if (s.disabled) delete next.disabled;
        else next.disabled = true;
        return next;
      })
    );
    setNotice(null);
  };

  const handleDelete = (key: string) => {
    update(sources.filter((s) => s.key !== key));
    setNotice(null);
  };

  const handleSave = () => {
    const { sources: cleaned, errors } = sanitizeUserSources(sources);
    saveUserSources(cleaned);
    setSources(cleaned);
    setDirty(false);
    const enabled = cleaned.filter((s) => !s.disabled).length;
    setNotice(
      errors.length > 0
        ? { kind: 'error', text: `已保存，但有问题：${errors.join('；')}` }
        : {
            kind: 'ok',
            text: `已保存并应用：共 ${cleaned.length} 个播放源，启用 ${enabled} 个。新的搜索立即生效`,
          }
    );
  };

  const handleExport = () => {
    setJsonText(JSON.stringify(toApiSiteMap(sources), null, 2));
    setShowJson(true);
    setNotice({ kind: 'ok', text: '已生成 JSON，可全选复制保存' });
  };

  const handleImport = (mode: 'merge' | 'replace') => {
    if (!jsonText.trim()) {
      setNotice({ kind: 'error', text: '请先粘贴 JSON' });
      return;
    }
    let items: unknown[];
    try {
      items = parseApiSiteJson(jsonText);
    } catch (err) {
      setNotice({
        kind: 'error',
        text: `JSON 解析失败：${
          err instanceof Error ? err.message : '格式错误'
        }`,
      });
      return;
    }
    const incoming = sanitizeUserSources(items);
    if (incoming.sources.length === 0) {
      setNotice({
        kind: 'error',
        text: incoming.errors[0] || '没有读到可用的播放源',
      });
      return;
    }

    let combined = incoming.sources;
    if (mode === 'merge') {
      const incomingKeys = new Set(incoming.sources.map((s) => s.key));
      const incomingApis = new Set(incoming.sources.map((s) => s.api));
      combined = [
        ...sources.filter(
          (s) => !incomingKeys.has(s.key) && !incomingApis.has(s.api)
        ),
        ...incoming.sources,
      ];
    }
    const merged = sanitizeUserSources(combined);
    update(merged.sources);
    const problems = [...incoming.errors, ...merged.errors];
    setNotice({
      kind: problems.length > 0 ? 'error' : 'ok',
      text:
        `已导入 ${incoming.sources.length} 个，点「保存并应用」后生效` +
        (problems.length > 0 ? `；跳过：${problems.join('；')}` : ''),
    });
  };

  const handleClose = () => {
    if (
      dirty &&
      !window.confirm('有修改还没保存，确定关闭吗？未保存的修改会丢失。')
    ) {
      return;
    }
    onClose();
  };

  return (
    <>
      <div
        className='fixed inset-0 bg-black/50 backdrop-blur-sm z-[1002]'
        onClick={handleClose}
      />

      <div className='fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-1.5rem)] max-w-lg max-h-[88vh] flex flex-col bg-white dark:bg-gray-900 rounded-xl shadow-xl z-[1003]'>
        {/* 标题栏 */}
        <div className='flex items-center justify-between px-5 pt-5 pb-3'>
          <h3 className='text-xl font-bold text-gray-800 dark:text-gray-200'>
            播放源管理
          </h3>
          <button
            onClick={handleClose}
            className='w-8 h-8 p-1 rounded-full flex items-center justify-center text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors'
            aria-label='Close'
          >
            <X className='w-full h-full' />
          </button>
        </div>

        <div className='flex-1 overflow-y-auto px-5 pb-4 space-y-5'>
          {/* 已有播放源 */}
          <div>
            <div className='flex items-center justify-between mb-2'>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                我的播放源（{sources.length}/{MAX_USER_SOURCES}）
              </h4>
              {dirty && (
                <span className='text-xs text-amber-600 dark:text-amber-400'>
                  有未保存的修改
                </span>
              )}
            </div>

            {sources.length === 0 ? (
              <p className='text-sm text-gray-500 dark:text-gray-400 border border-dashed border-gray-300 dark:border-gray-700 rounded-md px-3 py-4 text-center'>
                还没有播放源。在下面填写名称和接口地址添加。
              </p>
            ) : (
              <ul className='space-y-2'>
                {sources.map((source) => (
                  <li
                    key={source.key}
                    className='flex items-center gap-3 border border-gray-200 dark:border-gray-700 rounded-md px-3 py-2'
                  >
                    <div className='flex-1 min-w-0'>
                      <div
                        className={`text-sm font-medium truncate ${
                          source.disabled
                            ? 'text-gray-400 dark:text-gray-500'
                            : 'text-gray-800 dark:text-gray-200'
                        }`}
                      >
                        {source.name}
                      </div>
                      <div className='text-xs text-gray-500 dark:text-gray-400 truncate'>
                        {source.api}
                      </div>
                    </div>
                    <label
                      className='flex items-center cursor-pointer shrink-0'
                      title={source.disabled ? '已停用' : '已启用'}
                    >
                      <div className='relative'>
                        <input
                          type='checkbox'
                          className='sr-only peer'
                          checked={!source.disabled}
                          onChange={() => handleToggle(source.key)}
                        />
                        <div className='w-11 h-6 bg-gray-300 rounded-full peer-checked:bg-green-500 transition-colors dark:bg-gray-600'></div>
                        <div className='absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform peer-checked:translate-x-5'></div>
                      </div>
                    </label>
                    <button
                      onClick={() => handleDelete(source.key)}
                      className='shrink-0 w-8 h-8 p-1.5 rounded-full text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors'
                      aria-label={`删除 ${source.name}`}
                    >
                      <Trash2 className='w-full h-full' />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 添加表单 */}
          <div className='space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4'>
            <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
              添加播放源
            </h4>
            <input
              type='text'
              className={inputClass}
              placeholder='名称'
              maxLength={MAX_SOURCE_NAME_LEN}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <input
              type='url'
              inputMode='url'
              autoCapitalize='off'
              autoCorrect='off'
              className={inputClass}
              placeholder='接口地址，例如 https://example.com/api.php/provide/vod'
              value={api}
              onChange={(e) => setApi(e.target.value)}
            />
            <input
              type='url'
              inputMode='url'
              autoCapitalize='off'
              autoCorrect='off'
              className={inputClass}
              placeholder='详情地址（可选），例如 https://example.com'
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
            />
            <p className='text-xs text-gray-500 dark:text-gray-400'>
              接口需为苹果 CMS V10 的 JSON 接口。详情地址一般留空。
            </p>
            <button
              onClick={handleAdd}
              className='w-full flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-medium text-green-700 dark:text-green-300 border border-green-300 dark:border-green-700 hover:bg-green-50 dark:hover:bg-green-900/20 rounded-md transition-colors'
            >
              <Plus className='w-4 h-4' />
              加入列表
            </button>
          </div>

          {/* 批量导入导出 */}
          <div className='space-y-2 border-t border-gray-200 dark:border-gray-700 pt-4'>
            <div className='flex items-center justify-between'>
              <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                批量导入 / 导出（JSON）
              </h4>
              <button
                onClick={() => setShowJson(!showJson)}
                className='text-xs text-blue-600 dark:text-blue-400 hover:underline'
              >
                {showJson ? '收起' : '展开'}
              </button>
            </div>
            {showJson && (
              <>
                <textarea
                  className={`${inputClass} font-mono text-xs h-36`}
                  placeholder={
                    '{\n  "mysite": {\n    "api": "https://example.com/api.php/provide/vod",\n    "name": "我的源"\n  }\n}'
                  }
                  spellCheck={false}
                  value={jsonText}
                  onChange={(e) => setJsonText(e.target.value)}
                />
                <p className='text-xs text-gray-500 dark:text-gray-400'>
                  格式与 config.json 的 api_site 相同，也可以直接粘贴整份
                  config.json。
                </p>
                <div className='grid grid-cols-3 gap-2'>
                  <button
                    onClick={() => handleImport('merge')}
                    className='px-2 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
                  >
                    导入并合并
                  </button>
                  <button
                    onClick={() => handleImport('replace')}
                    className='px-2 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
                  >
                    导入并替换
                  </button>
                  <button
                    onClick={handleExport}
                    className='px-2 py-2 text-xs font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-md transition-colors'
                  >
                    导出当前列表
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 底部操作 */}
        <div className='px-5 pt-3 pb-5 border-t border-gray-200 dark:border-gray-700 space-y-3'>
          {notice && (
            <div
              role='status'
              className={`text-sm p-2.5 rounded-md border ${
                notice.kind === 'ok'
                  ? 'text-green-700 bg-green-50 border-green-200 dark:text-green-300 dark:bg-green-900/20 dark:border-green-800'
                  : 'text-red-600 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/20 dark:border-red-800'
              }`}
            >
              {notice.text}
            </div>
          )}
          <button
            onClick={handleSave}
            className='w-full px-4 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 dark:bg-green-700 dark:hover:bg-green-600 rounded-md transition-colors'
          >
            保存并应用
          </button>
          <p className='text-xs text-gray-500 dark:text-gray-400 text-center'>
            播放源只保存在这台设备的浏览器里，换设备需要重新导入
          </p>
        </div>
      </div>
    </>
  );
};

export default SourceManager;
