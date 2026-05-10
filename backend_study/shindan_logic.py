from enum import Enum

# 1. 判定結果のステータスを厳密に定義（これがデータ品質を高めるコツです）
class JudgeStatus(Enum):
    PASS = "適合"
    WARN = "要確認"
    FAIL = "不適合"

def evaluate_compliance(is_notified_area: bool, distance: int, floor_space: float):
    # --- 入力値のバリデーション（部品を壊さないためのガード） ---
    if distance < 0 or floor_space < 0:
        return {"status": "ERROR", "reason": "距離や面積にマイナスの値は入力できません。"}

    # --- 判定ロジック（佐藤さんのドメイン知識） ---
    if not is_notified_area:
        return {"status": JudgeStatus.FAIL.value, "reason": "告示地域外です。"}

    if floor_space < 16.5:
        return {"status": JudgeStatus.FAIL.value, "reason": f"床面積({floor_space}㎡)が不足しています。"}

    if distance < 100:
        return {"status": JudgeStatus.WARN.value, "reason": f"距離({distance}m)が近いため要調査です。"}

    return {"status": JudgeStatus.PASS.value, "reason": "基準をクリアしています。"}

# 4. データエンジニア・タスク：複数の一括処理（バッチ処理）
def batch_process_diagnositics(data_list):
    print(f"\n--- 本日の日報:一括診断レポート ---")
    for i, data in enumerate(data_list, 1):
        res = evaluate_compliance(
            data["is_notified"],
            data["distance"],
            data["floor_space"]
        )
        print(f"案件{i}: [{res['status']}] {res['reason']}")        

if __name__ == "__main__":
    # テスト用データセット（たとえ話の「材料リスト」）
    diagnostics_queue = [
        {"is_notified": True, "distance": 150, "floor_space": 20.0},
        {"is_notified": True, "distance": 80, "floor_space": 18.0},
        {"is_notified": False, "distance": 200, "floor_space": 25.0},
    ]
    batch_process_diagnositics(diagnostics_queue)