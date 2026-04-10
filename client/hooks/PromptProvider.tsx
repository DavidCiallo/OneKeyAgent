// PromptProvider.tsx (更新版本)

import { useState, createContext, useContext, ReactNode, Ref, useRef, FormEvent } from "react";
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Textarea } from "@heroui/react";

interface TextEditorPromptConfig {
    headerText?: string;
    defaultText?: string;
    placeholder?: string;
}

interface ComplexPromptConfig {
    header?: ReactNode;
    body?: (r: { ref: Ref<HTMLButtonElement>; onSubmit: (e: FormEvent<HTMLFormElement>) => void }) => ReactNode;
    footer?: (el: { onConfirm: () => void; onCancel: () => void }) => ReactNode;
}

interface PromptConfig extends TextEditorPromptConfig, ComplexPromptConfig {}
interface PromptContextType {
    showPrompt: (config: PromptConfig) => Promise<string | null>;
}

const PromptContext = createContext<PromptContextType | undefined>(undefined);

interface PromptState extends PromptConfig {
    isOpen: boolean;
    resolver: (value: string | null) => void;
}

// 3. PromptProvider 组件
export const TextEditorPromptProvider = ({ children }: { children: ReactNode }) => {
    const [promptState, setPromptState] = useState<PromptState | null>(null);
    const [currentText, setCurrentText] = useState("");

    const formRef = useRef<HTMLButtonElement>(null);

    // showPrompt 现在接收一个配置对象
    const showPrompt = (config: PromptConfig): Promise<string | null> => {
        return new Promise((resolve) => {
            setPromptState({
                ...config,
                isOpen: true,
                resolver: resolve,
            });
            setCurrentText(config.defaultText || "");
        });
    };

    const handleSave = (text?: string) => {
        if (promptState) {
            if (text) {
                setCurrentText(text);
                promptState.resolver(text);
            } else {
                promptState.resolver(currentText);
            }
            handleClose();
        }
    };

    const handleClose = () => {
        if (promptState) {
            promptState.resolver(null);
        }
        setPromptState(null);
        setCurrentText("");
    };

    const contextValue = { showPrompt };

    return (
        <PromptContext.Provider value={contextValue}>
            {children}
            {/* 渲染模态框：使用 promptState 中的配置项 */}
            {promptState && (
                <Modal className="w-full" isOpen={promptState.isOpen}>
                    <ModalContent className="min-w-[50vw]">
                        <ModalHeader className="w-full">{promptState.headerText || promptState.header}</ModalHeader>
                        <ModalBody className="w-full">
                            <div className="p-2">
                                {!!promptState.body ? (
                                    <div>
                                        {
                                            <promptState.body
                                                ref={formRef}
                                                onSubmit={async (e) => {
                                                    const submitData = Object.fromEntries(
                                                        new FormData(e.currentTarget)
                                                    );
                                                    handleSave(JSON.stringify(submitData));
                                                }}
                                            />
                                        }
                                    </div>
                                ) : (
                                    <Textarea
                                        defaultValue={promptState.defaultText}
                                        minRows={3}
                                        onChange={(e) => setCurrentText(e.target.value)}
                                        placeholder={promptState.placeholder}
                                    />
                                )}
                            </div>
                        </ModalBody>
                        <ModalFooter>
                            {!!promptState.footer ? (
                                <div>
                                    {promptState.footer({
                                        onConfirm: () => formRef.current?.click(),
                                        onCancel: handleClose,
                                    })}
                                </div>
                            ) : (
                                <>
                                    <Button size="sm" onClick={handleClose}>
                                        取消
                                    </Button>
                                    <Button size="sm" color="primary" onClick={() => handleSave()}>
                                        提交
                                    </Button>
                                </>
                            )}
                        </ModalFooter>
                    </ModalContent>
                </Modal>
            )}
        </PromptContext.Provider>
    );
};

export const useTextEditorPrompt = () => {
    const context = useContext(PromptContext);
    if (context === undefined) {
        throw new Error("useTextEditorPrompt 必须在 TextEditorPromptProvider 内部使用");
    }
    return context;
};
