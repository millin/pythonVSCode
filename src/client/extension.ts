'use strict';

import * as vscode from 'vscode';
import { PythonCompletionItemProvider } from './providers/completionProvider';
import { PythonHoverProvider } from './providers/hoverProvider';
import { PythonDefinitionProvider } from './providers/definitionProvider';
import { PythonReferenceProvider } from './providers/referenceProvider';
import { PythonRenameProvider } from './providers/renameProvider';
import { PythonFormattingEditProvider } from './providers/formatProvider';
import * as sortImports from './sortImports';
import { LintProvider } from './providers/lintProvider';
import { PythonSymbolProvider } from './providers/symbolProvider';
import { PythonSignatureProvider } from './providers/signatureProvider';
import * as settings from './common/configSettings';
import * as telemetryHelper from './common/telemetry';
import * as telemetryContracts from './common/telemetryContracts';
import { activateSimplePythonRefactorProvider } from './providers/simpleRefactorProvider';
import { activateSetInterpreterProvider } from './providers/setInterpreterProvider';
import { activateExecInTerminalProvider } from './providers/execInTerminalProvider';
import { Commands } from './common/constants';
import * as tests from './unittests/main';
import { HelpProvider } from './helpProvider';
import { activateUpdateSparkLibraryProvider } from './providers/updateSparkLibraryProvider';
import { activateFormatOnSaveProvider } from './providers/formatOnSaveProvider';
import { WorkspaceSymbols } from './workspaceSymbols/main';
import { BlockFormatProviders } from './typeFormatters/blockFormatProvider';
import { JupyterProvider } from './jupyter/provider';
import * as os from 'os';


const PYTHON: vscode.DocumentFilter = { language: 'python', scheme: 'file' };
let unitTestOutChannel: vscode.OutputChannel;
let formatOutChannel: vscode.OutputChannel;
let lintingOutChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    let pythonSettings = settings.PythonSettings.getInstance();
    const hasPySparkInCompletionPath = pythonSettings.autoComplete.extraPaths.some(p => p.toLowerCase().indexOf('spark') >= 0);
    telemetryHelper.sendTelemetryEvent(telemetryContracts.EVENT_LOAD, {
        CodeComplete_Has_ExtraPaths: pythonSettings.autoComplete.extraPaths.length > 0 ? 'true' : 'false',
        Format_Has_Custom_Python_Path: pythonSettings.pythonPath.length !== 'python'.length ? 'true' : 'false',
        Has_PySpark_Path: hasPySparkInCompletionPath ? 'true' : 'false'
    });
    lintingOutChannel = vscode.window.createOutputChannel(pythonSettings.linting.outputWindow);
    formatOutChannel = lintingOutChannel;
    if (pythonSettings.linting.outputWindow !== pythonSettings.formatting.outputWindow) {
        formatOutChannel = vscode.window.createOutputChannel(pythonSettings.formatting.outputWindow);
        formatOutChannel.clear();
    }
    if (pythonSettings.linting.outputWindow !== pythonSettings.unitTest.outputWindow) {
        unitTestOutChannel = vscode.window.createOutputChannel(pythonSettings.unitTest.outputWindow);
        unitTestOutChannel.clear();
    }

    sortImports.activate(context, formatOutChannel);
    context.subscriptions.push(activateSetInterpreterProvider());
    context.subscriptions.push(...activateExecInTerminalProvider());
    context.subscriptions.push(activateUpdateSparkLibraryProvider());
    activateSimplePythonRefactorProvider(context, formatOutChannel);
    context.subscriptions.push(activateFormatOnSaveProvider(PYTHON, settings.PythonSettings.getInstance(), formatOutChannel));

    context.subscriptions.push(vscode.commands.registerCommand(Commands.Start_REPL, () => {
        let term = vscode.window.createTerminal('Python', pythonSettings.pythonPath);
        term.show();
        context.subscriptions.push(term);
    }));

    // Enable indentAction
    vscode.languages.setLanguageConfiguration(PYTHON.language, {
        onEnterRules: [
            {
                beforeText: /^\s*(?:def|class|for|if|elif|else|while|try|with|finally|except|async).*?:\s*$/,
                action: { indentAction: vscode.IndentAction.Indent }
            },
            {
                beforeText: /^ *#.*$/,
                afterText: /.+$/,
                action: { indentAction: vscode.IndentAction.None, appendText: '# ' }
            }
        ]
    });

    context.subscriptions.push(vscode.languages.registerRenameProvider(PYTHON, new PythonRenameProvider(formatOutChannel)));
    const definitionProvider = new PythonDefinitionProvider(context);
    const jediProx = definitionProvider.JediProxy;
    context.subscriptions.push(vscode.languages.registerDefinitionProvider(PYTHON, definitionProvider));
    context.subscriptions.push(vscode.languages.registerHoverProvider(PYTHON, new PythonHoverProvider(context, jediProx)));
    context.subscriptions.push(vscode.languages.registerReferenceProvider(PYTHON, new PythonReferenceProvider(context, jediProx)));
    context.subscriptions.push(vscode.languages.registerCompletionItemProvider(PYTHON, new PythonCompletionItemProvider(context, jediProx), '.'));

    context.subscriptions.push(vscode.languages.registerDocumentSymbolProvider(PYTHON, new PythonSymbolProvider(context, jediProx)));
    if (pythonSettings.devOptions.indexOf('DISABLE_SIGNATURE') === -1) {
        context.subscriptions.push(vscode.languages.registerSignatureHelpProvider(PYTHON, new PythonSignatureProvider(context, jediProx), '(', ','));
    }
    const formatProvider = new PythonFormattingEditProvider(context, formatOutChannel, pythonSettings);
    context.subscriptions.push(vscode.languages.registerDocumentFormattingEditProvider(PYTHON, formatProvider));
    context.subscriptions.push(vscode.languages.registerDocumentRangeFormattingEditProvider(PYTHON, formatProvider));

    context.subscriptions.push(new LintProvider(context, lintingOutChannel, documentHasJupyterCodeCells));
    tests.activate(context, unitTestOutChannel);

    context.subscriptions.push(new WorkspaceSymbols(lintingOutChannel));

    context.subscriptions.push(vscode.languages.registerOnTypeFormattingEditProvider(PYTHON, new BlockFormatProviders(), ':'));
    // In case we have CR LF
    const triggerCharacters: string[] = os.EOL.split('');
    triggerCharacters.shift();

    const hepProvider = new HelpProvider();
    context.subscriptions.push(hepProvider);

    registerJupyterProvider();
}
function documentHasJupyterCodeCells(doc: vscode.TextDocument, token: vscode.CancellationToken): Promise<Boolean> {
    return Promise.resolve(false);
}

function registerJupyterProvider() {
    const jupyterExt = vscode.extensions.getExtension('donjayamanne.jupyter');
    if (!jupyterExt) {
        return;
    }
    if (jupyterExt.isActive) {
        jupyterExt.exports.registerLanguageProvider(PYTHON.language, new JupyterProvider());
    }

    jupyterExt.activate().then(() => {
        jupyterExt.exports.registerLanguageProvider(PYTHON.language, new JupyterProvider());
    });
}

// this method is called when your extension is deactivated
export function deactivate() {
}