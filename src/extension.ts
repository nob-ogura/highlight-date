// src/extension.ts
import * as vscode from 'vscode';

// 過去の日付用デコレーションタイプ
const pastDateDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: 'rgb(255, 0, 0)', // 赤
    color: 'white',
});

// 将来の日付用のデコレーションタイプを保持するマップ
const futureDecorationTypes: Map<number, vscode.TextEditorDecorationType> = new Map();

// 拡張機能がアクティブになったときに呼ばれる関数
export const activate = (context: vscode.ExtensionContext) => {
    // updateDecorationsを頻繁に呼びすぎないようにするためのスロットリング
    let timeout: NodeJS.Timeout | undefined = undefined;
    const triggerUpdateDecorations = (throttle: boolean = true) => {
        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }
        if (throttle) {
            timeout = setTimeout(updateDecorations, 200); // 200msの遅延
        } else {
            updateDecorations(); // 遅延なしで即時実行
        }
    }

    // 明示的なコマンドを登録して手動でハイライトを更新できるようにする
    const refreshCommand = vscode.commands.registerCommand('highlight-date.refreshHighlights', () => {
        if (vscode.window.activeTextEditor) {
            updateDecorations();
        }
    });

    context.subscriptions.push(refreshCommand);

    let activeEditor = vscode.window.activeTextEditor;

    // 日数差に基づいて色を計算する関数
    const calculateColor = (diffDays: number): string => {
        if (diffDays <= 0) {
            // 過去または今日
            return 'rgb(255, 0, 0)';
        } else if (diffDays >= 50) {
            // 50日以上先の未来
            return 'rgb(0, 0, 255)';
        } else {
            // 1〜49日後: 徐々に赤から青へ (RGB値が3ずつ変化)
            const redValue = Math.max(0, 255 - (diffDays * 3 * 255 / 50));
            const blueValue = Math.min(255, (diffDays * 3 * 255 / 50));
            return `rgb(${Math.round(redValue)}, 0, ${Math.round(blueValue)})`;
        }
    }

    // 日数差に基づいたデコレーションタイプを取得する関数
    const getOrCreateDecorationType = (diffDays: number): vscode.TextEditorDecorationType => {
        if (diffDays <= 0) {
            return pastDateDecorationType;
        }
        
        if (!futureDecorationTypes.has(diffDays)) {
            const decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: calculateColor(diffDays),
                color: 'white',
            });
            futureDecorationTypes.set(diffDays, decorationType);
            context.subscriptions.push(decorationType);
        }
        
        return futureDecorationTypes.get(diffDays)!;
    }

    // ハイライトを更新する関数
    const updateDecorations = () => {
        if (!activeEditor) {
            return;
        }
        
        // ローカル変数に代入して型を明確にする
        const editor = activeEditor;
        const text = editor.document.getText();
        
        // yyyy-MM-dd 形式の正規表現 (単語境界 \b を追加して、2023-01-01-extra のようなものを避ける)
        const dateRegex = /\b\d{4}-\d{2}-\d{2}\b/g;
        
        // 日付ごとのデコレーション情報を保持するマップ
        const decorationsMap: Map<number, vscode.DecorationOptions[]> = new Map();
        
        let match;
        const today = new Date();
        today.setHours(0, 0, 0, 0); // 時刻部分をリセット
        
        while ((match = dateRegex.exec(text))) {
            const dateStr = match[0];
            const date = new Date(dateStr);
            
            const startPos = editor.document.positionAt(match.index);
            const endPos = editor.document.positionAt(match.index + match[0].length);
            
            const diffTime = date.getTime() - today.getTime();
            const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
            
            const decoration = {
                range: new vscode.Range(startPos, endPos),
            };
            
            // 日数差ごとにデコレーションを分類
            if (!decorationsMap.has(diffDays)) {
                decorationsMap.set(diffDays, []);
            }
            decorationsMap.get(diffDays)!.push(decoration);
        }

        // 現在のエディタの全てのデコレーションをクリア
        editor.setDecorations(pastDateDecorationType, []);
        futureDecorationTypes.forEach(decType => {
            editor.setDecorations(decType, []);
        });

        // 日数差ごとに適切なデコレーションを適用
        decorationsMap.forEach((decorations, diffDays) => {
            const decorationType = getOrCreateDecorationType(diffDays);
            editor.setDecorations(decorationType, decorations);
        });
    }

    // 初回起動時、またはウィンドウリロード時にアクティブエディタがあれば実行
    if (activeEditor) {
        triggerUpdateDecorations(false); // 初回は遅延なしで実行
    }

    // アクティブなエディタが変更されたときにハイライトを更新
    vscode.window.onDidChangeActiveTextEditor(editor => {
        activeEditor = editor;
        if (editor) {
            triggerUpdateDecorations(false); // エディタ変更時も遅延なし
        }
    }, null, context.subscriptions);

    // ドキュメントの内容が変更されたときにハイライトを更新
    vscode.workspace.onDidChangeTextDocument(event => {
        if (activeEditor && event.document === activeEditor.document) {
            triggerUpdateDecorations(); // テキスト変更時は遅延あり
        }
    }, null, context.subscriptions);

}

// 拡張機能が無効になったときに呼ばれる関数
export const deactivate = () => {
    // デコレーションタイプを破棄
    pastDateDecorationType.dispose();
    futureDecorationTypes.forEach(decorationType => {
        decorationType.dispose();
    });
    futureDecorationTypes.clear();
}