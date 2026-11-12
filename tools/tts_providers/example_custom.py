"""自定义 TTS 模型插件示例模板。"""


async def synthesize(text: str, out_path: str, cfg: dict) -> list[tuple[float, float, str]]:
    """合成单句语音写入 out_path；若无逐词边界返回 [] 即可，底座自动执行声学能量对齐。"""
    raise NotImplementedError('Implement custom TTS synthesis writing audio to out_path.')
