import * as assert from 'node:assert';
import * as vscode from 'vscode';

interface ExtensionApi {
  getPreviewPanel: () => { dispose: () => void } | undefined;
  setPreviewTestObserver: (observer?: (msg: Record<string, unknown>) => void) => void;
}

interface DiagramObservationMessage {
  command: string;
  generation?: number;
  svgCount?: number;
  errorCardCount?: number;
  errorCodes?: string[];
  blockedURI?: string;
  violatedDirective?: string;
}

export async function runExtensionSmokeTests(): Promise<void> {
  console.log('Starting VS Code extension smoke tests...');

  // 0. Node.js バージョン確認 (Node.js >= 22.12.0)
  const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
  console.log(`Extension host Node.js version: ${process.versions.node}`);
  assert.ok(
    nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 12),
    `Node.js version must be >= 22.12.0, but got ${process.versions.node}`
  );

  // 1. 拡張機能のロード確認
  const ext = vscode.extensions.getExtension('ikaruga-tech.md-tech-slide');
  assert.ok(ext, 'Extension ikaruga-tech.md-tech-slide must be present in extension registry');

  // 2. 拡張機能のアクティベーション
  let api: ExtensionApi;
  if (!ext.isActive) {
    api = (await ext.activate()) as ExtensionApi;
  } else {
    api = ext.exports as ExtensionApi;
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
    content: '# Test Slide\n::: invalid-container-name\nContent\n:::\n\n```mermaid\n\n```\n',
  });
  await vscode.window.showTextDocument(testDoc);

  try {
    const startTime = Date.now();
    const timeoutMs = 5000;
    const intervalMs = 50;
    let lastDiagnostics: vscode.Diagnostic[] = [];
    let matchedSyntax = false;
    let matchedMermaid = false;

    while (Date.now() - startTime < timeoutMs) {
      lastDiagnostics = vscode.languages.getDiagnostics(testDoc.uri);
      const slideIssues = lastDiagnostics.filter((d) => d.source === 'md-tech-slide');
      if (slideIssues.some((d) => d.code === 'unknown-container')) {
        matchedSyntax = true;
      }
      if (slideIssues.some((d) => d.code === 'mermaid-empty-source')) {
        matchedMermaid = true;
      }
      if (matchedSyntax && matchedMermaid) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }

    if (!matchedSyntax || !matchedMermaid) {
      const details = lastDiagnostics.map((d) => ({
        code: d.code,
        message: d.message,
        source: d.source,
      }));
      throw new Error(
        `Timed out waiting for diagnostic issues (syntax: ${matchedSyntax}, mermaid: ${matchedMermaid}). Received ${lastDiagnostics.length} diagnostics: ${JSON.stringify(details)}`
      );
    }
    console.log(
      'DiagnosticCollection correctly generated syntax and mermaid diagnostic issues via user event path'
    );

    // 6. 不正なMermaid構文による非同期 mermaid-invalid-syntax 発行と、修正時のDiagnostic消去検証
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      // 不正なMermaidコードを入力
      await editor.edit((editBuilder) => {
        const fullRange = new vscode.Range(
          testDoc.positionAt(0),
          testDoc.positionAt(testDoc.getText().length)
        );
        editBuilder.replace(
          fullRange,
          '# Slide 1\n\n```mermaid\nflowchart TD\n  A[broken --> B\n```\n'
        );
      });

      // 非同期診断で mermaid-invalid-syntax が発行されるのを待機
      const asyncStartTime = Date.now();
      let hasInvalidSyntax = false;
      while (Date.now() - asyncStartTime < 10000) {
        const diags = vscode.languages.getDiagnostics(testDoc.uri);
        if (diags.some((d) => d.code === 'mermaid-invalid-syntax')) {
          hasInvalidSyntax = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(
        hasInvalidSyntax,
        'Diagnostic with code "mermaid-invalid-syntax" must be emitted for malformed Mermaid'
      );
      console.log('Successfully received asynchronous mermaid-invalid-syntax diagnostic');

      // 構文を修正
      await editor.edit((editBuilder) => {
        const fullRange = new vscode.Range(
          testDoc.positionAt(0),
          testDoc.positionAt(testDoc.getText().length)
        );
        editBuilder.replace(
          fullRange,
          '# Slide 1\n\n```mermaid\nflowchart TD\n  A[Start] --> B[End]\n```\n'
        );
      });

      // 修正後に古い mermaid-invalid-syntax が消去されるのを待機
      const fixStartTime = Date.now();
      let errorCleared = false;
      while (Date.now() - fixStartTime < 10000) {
        const diags = vscode.languages.getDiagnostics(testDoc.uri);
        if (!diags.some((d) => d.code === 'mermaid-invalid-syntax')) {
          errorCleared = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      assert.ok(
        errorCleared,
        'Old mermaid-invalid-syntax diagnostic must be cleared after fixing Mermaid syntax'
      );
      console.log('Diagnostic was successfully cleared upon fixing syntax');
    }

    // 7. 実Webviewの表示、CSP違反ゼロ、エラーカード表示の確定観測検証（偽陽性完全排除）
    const observedCspViolations: Record<string, unknown>[] = [];
    const observationMessages: DiagramObservationMessage[] = [];
    let webviewReadyReceived = false;
    let webviewReadyResolve: (() => void) | null = null;

    api.setPreviewTestObserver((msg) => {
      const typedMsg = msg as unknown as DiagramObservationMessage;
      if (typedMsg.command === 'webviewReady') {
        webviewReadyReceived = true;
        webviewReadyResolve?.();
      } else if (typedMsg.command === 'securityPolicyViolation') {
        observedCspViolations.push(msg);
      } else if (typedMsg.command === 'diagramObservation') {
        observationMessages.push(typedMsg);
      }
    });

    try {
      const readyPromise = new Promise<void>((r) => {
        webviewReadyResolve = r;
      });

      await vscode.commands.executeCommand('md-tech-slide.openPreview');
      console.log('Slide preview panel opened successfully via command');

      // 1. webviewReady ハンドシェイクの待機（最大8秒、未受信時は明示的テスト失敗）
      const readyTimeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out waiting for webviewReady handshake')), 8000)
      );
      await Promise.race([readyPromise, readyTimeout]);
      assert.strictEqual(webviewReadyReceived, true, 'Webview must complete ready handshake');
      console.log('Received webviewReady handshake from active webview');

      // 2. 正常ダイアグラムの確定観測待機（svgCount > 0 かつ errorCardCount === 0）
      const obsStartTime = Date.now();
      let normalObservation: DiagramObservationMessage | undefined;
      while (Date.now() - obsStartTime < 8000) {
        normalObservation = observationMessages.find(
          (m) => (m.svgCount ?? 0) > 0 && (m.errorCardCount ?? 0) === 0
        );
        if (normalObservation) {
          break;
        }
        await new Promise((r) => setTimeout(r, 100));
      }

      assert.ok(
        normalObservation,
        `Expected diagramObservation with svgCount > 0 and errorCardCount === 0, but received: ${JSON.stringify(observationMessages)}`
      );
      assert.ok(
        (normalObservation.svgCount ?? 0) > 0,
        `svgCount must be strictly greater than 0, got ${normalObservation.svgCount}`
      );
      assert.strictEqual(
        normalObservation.errorCardCount,
        0,
        `errorCardCount must be strictly 0 on valid diagram, got ${normalObservation.errorCardCount}`
      );
      assert.strictEqual(
        observedCspViolations.length,
        0,
        `Expected 0 securitypolicyviolation events in real Webview, received ${observedCspViolations.length}: ${JSON.stringify(observedCspViolations)}`
      );
      console.log(
        `Observed valid diagram in Webview (svgCount: ${normalObservation.svgCount}, errorCardCount: 0, CSP violations: 0)`
      );

      const initialGen = normalObservation.generation ?? 0;

      // 3. 不正構文への更新時：新世代エラーカード表示とCSP違反0件の検証
      if (editor) {
        const activeDocEditor = await vscode.window.showTextDocument(testDoc, { preview: false });
        await activeDocEditor.edit((editBuilder) => {
          const fullRange = new vscode.Range(
            testDoc.positionAt(0),
            testDoc.positionAt(testDoc.getText().length)
          );
          editBuilder.replace(
            fullRange,
            '# Slide With Bad Syntax\n\n```mermaid\ngraph TD\n  Broken[Node --> \n```\n'
          );
        });

        // 新しい generation でエラーカードが描画されるのを待機
        const errorStartTime = Date.now();
        let errorObservation: DiagramObservationMessage | undefined;
        while (Date.now() - errorStartTime < 8000) {
          errorObservation = observationMessages.find(
            (m) =>
              (m.generation ?? 0) > initialGen &&
              (m.errorCardCount ?? 0) > 0 &&
              m.errorCodes?.includes('mermaid-invalid-syntax')
          );
          if (errorObservation) {
            break;
          }
          await new Promise((r) => setTimeout(r, 100));
        }

        assert.ok(
          errorObservation,
          `Expected diagramObservation with errorCardCount > 0 and code "mermaid-invalid-syntax" for generation > ${initialGen}, but received: ${JSON.stringify(observationMessages)}`
        );
        assert.ok(
          (errorObservation.errorCardCount ?? 0) > 0,
          `errorCardCount must be strictly greater than 0, got ${errorObservation.errorCardCount}`
        );
        assert.ok(
          errorObservation.errorCodes?.includes('mermaid-invalid-syntax'),
          'errorCodes must include mermaid-invalid-syntax'
        );

        // CSP違反が依然として 0 件であることを確認
        assert.strictEqual(
          observedCspViolations.length,
          0,
          `Expected 0 CSP violations after rendering error card, received ${observedCspViolations.length}: ${JSON.stringify(observedCspViolations)}`
        );
        console.log(
          `Observed error card in Webview (generation: ${errorObservation.generation}, errorCardCount: ${errorObservation.errorCardCount}, CSP violations: 0)`
        );
      }
    } finally {
      api.setPreviewTestObserver(undefined);
      api.getPreviewPanel()?.dispose();
    }
  } finally {
    // 未保存ダイアログによる停止を防ぐため、アクティブエディタのURIを照合して変更破棄クローズを実行
    if (vscode.window.activeTextEditor?.document.uri.toString() === testDoc.uri.toString()) {
      await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
    }
  }
}
