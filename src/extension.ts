// src/extension.ts
import * as vscode from 'vscode';
import { isWeekend, eachDayOfInterval, differenceInDays, isValid, parse } from 'date-fns';

// フィボナッチ数列の境界値を定義
const FIBONACCI_BOUNDARIES = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
const MAX_FIBONACCI_NUMBER = FIBONACCI_BOUNDARIES[FIBONACCI_BOUNDARIES.length - 1];

// 文字色
const TEXT_COLOR = 'black';
const MAX_HUE = 210;
const RED_HUE = 'hsl(0, 100%, 50%)'
const BLUE_HUE = `hsl(${MAX_HUE}, 100%, 50%)`

// 過去の日付用デコレーションタイプ
const pastDateDecorationType = vscode.window.createTextEditorDecorationType({
    backgroundColor: RED_HUE,
    color: TEXT_COLOR,
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

    // 日数差をフィボナッチ数列の境界値に基づいて分類する関数
    const getFibonacciCategory = (diffDays: number): number => {
        if (diffDays <= 0) {
            return 0; // 過去または今日
        }
        if (diffDays > MAX_FIBONACCI_NUMBER) {
            return MAX_FIBONACCI_NUMBER; // 最大日数以上先の未来
        }
        
        // フィボナッチ数列の境界値の中で、diffDaysを超えない最大の値を返す
        const category = [...FIBONACCI_BOUNDARIES].reverse().find(boundary => diffDays >= boundary);
        return category ?? 1; // 1日未満の場合は1として扱う
    }

    // 日数差に基づいて色を計算する関数
    const calculateColor = (fibonacciCategory: number): string => {
        if (fibonacciCategory <= 0) {
            // 過去または今日
            return RED_HUE;
        } else if (fibonacciCategory >= FIBONACCI_BOUNDARIES[FIBONACCI_BOUNDARIES.length - 1]) {
            // 最大日数以上先の未来
            return BLUE_HUE;
        } else {
            // フィボナッチ数列の境界値に基づいて色相を計算
            const index = FIBONACCI_BOUNDARIES.indexOf(fibonacciCategory) + 1;
            const maxIndex = FIBONACCI_BOUNDARIES.length;
            const ratio = index / maxIndex;
            
            // 色相を0から240の間で補間（赤から青へ）
            const hue = Math.round(ratio * MAX_HUE);
            return `hsl(${hue}, 100%, 50%)`;
        }
    }

    // 日数差に基づいたデコレーションタイプを取得する関数
    const getOrCreateDecorationType = (fibonacciCategory: number): vscode.TextEditorDecorationType => {
        if (fibonacciCategory <= 0) {
            return pastDateDecorationType;
        }
        
        if (!futureDecorationTypes.has(fibonacciCategory)) {
            const decorationType = vscode.window.createTextEditorDecorationType({
                backgroundColor: calculateColor(fibonacciCategory),
                color: TEXT_COLOR,
            });
            futureDecorationTypes.set(fibonacciCategory, decorationType);
            context.subscriptions.push(decorationType);
        }
        
        return futureDecorationTypes.get(fibonacciCategory)!;
    }

    // 土日を除く日数を計算する関数
    const calculateBusinessDays = (startDate: Date, endDate: Date): number => {
        if (startDate.getTime() === endDate.getTime()) return 0;
        const days = eachDayOfInterval({ start: startDate, end: endDate });
        return days.filter(day => !isWeekend(day)).length;
    };

    // 日付の妥当性をチェックする関数
    const isValidDate = (dateStr: string): boolean => {
        const parsedDate = parse(dateStr, 'yyyy-MM-dd', new Date());
        return isValid(parsedDate);
    };

    // ハイライトを更新する関数
    const updateDecorations = () => {
        if (!activeEditor) {
            return;
        }
        
        // ローカル変数に代入して型を明確にする
        const editor = activeEditor;
        const text = editor.document.getText();
        
        // yyyy-MM-dd 形式の正規表現 (前後に空白文字があることを確認)
        const dateRegex = /(?<=\s|^)\d{4}-\d{2}-\d{2}(?=\s|$)/g;
        
        // 日付ごとのデコレーション情報を保持するマップ
        const decorationsMap: Map<number, vscode.DecorationOptions[]> = new Map();
        
        let match;
        const today = new Date();
        today.setHours(0, 0, 0, 0); // 時刻部分をリセット
        
        while ((match = dateRegex.exec(text))) {
            const dateStr = match[0];
            
            // 日付の妥当性をチェック
            if (!isValidDate(dateStr)) {
                continue; // 不正な日付はスキップ
            }
            
            const date = new Date(dateStr);
            date.setHours(0, 0, 0, 0); // 時刻部分をリセット
            
            const startPos = editor.document.positionAt(match.index - 1);
            const endPos = editor.document.positionAt(match.index + match[0].length + 1);
            
            // 日付の前後関係に応じて開始日と終了日を設定
            const [start, end] = date < today ? [date, today] : [today, date];
            const diffDays = calculateBusinessDays(start, end);
            // 過去の日付の場合は負の値にする
            const signedDiffDays = date < today ? -diffDays : diffDays;
            
            const fibonacciCategory = getFibonacciCategory(signedDiffDays);
            
            const decoration = {
                range: new vscode.Range(startPos, endPos),
            };
            
            // フィボナッチカテゴリごとにデコレーションを分類
            if (!decorationsMap.has(fibonacciCategory)) {
                decorationsMap.set(fibonacciCategory, []);
            }
            decorationsMap.get(fibonacciCategory)!.push(decoration);
        }

        // 現在のエディタの全てのデコレーションをクリア
        editor.setDecorations(pastDateDecorationType, []);
        futureDecorationTypes.forEach(decType => {
            editor.setDecorations(decType, []);
        });

        // フィボナッチカテゴリごとに適切なデコレーションを適用
        decorationsMap.forEach((decorations, fibonacciCategory) => {
            const decorationType = getOrCreateDecorationType(fibonacciCategory);
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