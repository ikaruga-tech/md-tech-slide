import * as assert from 'node:assert';
import * as vscode from 'vscode';

export async function runExtensionSmokeTests(): Promise<void> {
  console.log('Starting VS Code extension smoke tests...');

  // 1. 拡張機能のロード確認
  const ext = vscode.extensions.getExtension('ikaruga-tech.md-tech-slide');
  assert.ok(ext, 'Extension ikaruga-tech.md-tech-slide must be present in extension registry');

  // 2. 拡張機能のアクティベーション
  if (!ext.isActive) {
    await ext.activate();
  }
  assert.strictEqual(ext.isActive, true, 'Extension must be active');
  console.log('Extension ikaruga-tech.md-tech-slide activated successfully');

  // 3. 登録されたコマンドの確認
  const allCommands = await vscode.commands.getCommands(true);
  const requiredCommands = [
    'md-tech-slide.openPreview',
    'md-tech-slide.exportPPTX',
    'md-tech-slide.exportPDF',
  ];

  for (const cmd of requiredCommands) {
    assert.ok(
      allCommands.includes(cmd),
      `Required command "${cmd}" must be registered in VS Code command registry`
    );
  }
  console.log('All required commands are registered:', requiredCommands);

  // 4. 設定のデフォルト値確認（型および package.json で定義した実際のデフォルト値）
  const config = vscode.workspace.getConfiguration('mdTechSlide');
  assert.strictEqual(
    config.get('defaultTheme'),
    'default',
    'mdTechSlide.defaultTheme default value must be "default"'
  );
  assert.strictEqual(
    config.get('defaultAspectRatio'),
    '16:9',
    'mdTechSlide.defaultAspectRatio default value must be "16:9"'
  );
  assert.strictEqual(
    config.get('export.browserPath'),
    '',
    'mdTechSlide.export.browserPath default value must be empty string'
  );
  console.log('Configuration schema and default values verified successfully');

  // 5. 利用者導線（ドキュメントオープンおよびエディタ表示）による診断発行の検証
  const testDoc = await vscode.workspace.openTextDocument({
    language: 'markdown',
    content: '# Test Slide\n::: invalid-container-name\nContent\n:::\n',
  });
  await vscode.window.showTextDocument(testDoc);

  try {
    const startTime = Date.now();
    const timeoutMs = 5000;
    const intervalMs = 50;
    let lastDiagnostics: vscode.Diagnostic[] = [];
    let matched = false;

    while (Date.now() - startTime < timeoutMs) {
      lastDiagnostics = vscode.languages.getDiagnostics(testDoc.uri);
      const slideIssues = lastDiagnostics.filter((d) => d.source === 'md-tech-slide');
      if (slideIssues.some((d) => d.code === 'unknown-container')) {
        matched = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    if (!matched) {
      const details = lastDiagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        source: d.source,
      }));
      throw new Error(
        `Timed out waiting for diagnostic issues. Received ${lastDiagnostics.length} diagnostics: ${JSON.stringify(details)}`
      );
    }
    console.log('DiagnosticCollection correctly generated diagnostic issues via user event path');
  } finally {
    // 未保存ダイアログによる停止を防ぐため、アクティブエディタのURIを照合して変更破棄クローズを実行
    if (vscode.window.activeTextEditor?.document.uri.toString() === testDoc.uri.toString()) {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  }
}
