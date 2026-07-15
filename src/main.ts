import { InstanceBase, InstanceStatus, TCPHelper, type SomeCompanionConfigField } from '@companion-module/base'

interface LindyConfig extends Record<string, any> {
	host: string
	port: number
}

interface LindyTypes {
	config: LindyConfig
	secrets: Record<string, never>
	actions: Record<string, never>
	feedbacks: Record<string, never>
	variables: Record<string, never>
}

/*const CHOICE_INPUTS = Array.from({ length: 16 }, (_, i) => ({
	id: String(i + 1),
	label: `Input ${i + 1}`,
}))

const CHOICES_OUTPUTS = [
	{ id: '0', label: 'All Outputs' },
	...Array.from({ length: 16 }, (_, i) => ({
		id: String(i + 1),
		label: `Output ${i + 1}`,
	})),
]*/

const CHOICE_PRESETS = Array.from({ length: 16 }, (_, i) => ({
	id: String(i + 1),
	label: `Preset ${i + 1}`,
}))

const CHOICES_EDID = [
	{ id: '1', label: '1080p, Stereo Audio 2.0' },
	{ id: '2', label: '1080p, Dolby/DTS 5.1' },
	{ id: '3', label: '1080p, HD Audio 7.1' },
	{ id: '4', label: '1080i, Stereo Audio 2.0' },
	{ id: '5', label: '1080i, Dolby/DTS 5.1' },
	{ id: '6', label: '1080i, HD Audio 7.1' },
	{ id: '7', label: '3D, Stereo Audio 2.0' },
	{ id: '8', label: '3D, Dolby/DTS 5.1' },
	{ id: '9', label: '3D, HD Audio 7.1' },
	{ id: '10', label: '4K2K30_444, Stereo Audio 2.0' },
	{ id: '11', label: '4K2K30_444, Dolby/DTS 5.1' },
	{ id: '12', label: '4K2K30_444, HD Audio 7.1' },
	{ id: '13', label: '4K2K60_420, Stereo Audio 2.0' },
	{ id: '14', label: '4K2K60_420, Dolby/DTS 5.1' },
	{ id: '15', label: '4K2K60_420, HD Audio 7.1' },
	{ id: '16', label: '4K2K60_444, Stereo Audio 2.0' },
	{ id: '17', label: '4K2K60_444, Dolby/DTS 5.1' },
	{ id: '18', label: '4K2K60_444, HD Audio 7.1' },
	{ id: '19', label: '4K2K60_444, Stereo Audio 2.0 HDR' },
	{ id: '20', label: '4K2K60_444, Dolby/DTS 5.1 HDR' },
	{ id: '21', label: '4K2K60_444, HD Audio 7.1 HDR' },
	{ id: '22', label: 'User1' },
	{ id: '23', label: 'User2' },
	...Array.from({ length: 16 }, (_, i) => ({
		id: String(i + 24),
		label: `Copy from HDMI Output ${i + 1}`,
	})),
]

class LindyMatrixInstance extends InstanceBase<LindyTypes> {
	private tcp: TCPHelper | null = null
	private isPoweredOn: boolean = true
	private currentRouting: Map<string, string> = new Map()
	private config!: LindyConfig

	async init(config: LindyConfig, _isFirstInit: boolean, _secrets: unknown): Promise<void> {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)
		this.connectTCP(config)
		this.registerActions()
		this.registerFeedbacks()
		this.registerVariables()
		this.registerPresets()

		void this.fetchVideoStatus()
		setInterval(() => {
			void this.fetchVideoStatus()
		}, 6000)
	}

	async destroy(): Promise<void> {
		this.tcp?.destroy()
	}

	private inputNames: Map<number, string> = new Map()
	private outputNames: Map<number, string> = new Map()

	// configUpdated reçoit aussi 2 arguments en v2.0.4
	async configUpdated(config: LindyConfig, _secrets: unknown): Promise<void> {
		this.tcp?.destroy()
		this.connectTCP(config)
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'IP Address',
				default: '192.168.1.100',
				width: 8,
			},
			{
				type: 'number',
				id: 'port',
				label: 'TCP Port',
				default: 8000,
				min: 1,
				max: 65535,
				width: 4,
			},
		]
	}

	private isPanelLocked: boolean = false
	private hdmiStreamState: Map<string, boolean> = new Map()

	private registerVariables(): void {
		const inputVars: Record<string, any> = {}
		const outputVars: Record<string, any> = {}

		for (let i = 1; i <= 16; i++) {
			inputVars[`input_${i}_name`] = {
				name: `Nom Input ${i}`,
			}
		}

		for (let i = 1; i <= 16; i++) {
			outputVars[`output_${i}_name`] = {
				name: `Nom Output ${i}`,
			}
		}

		;(this as any).setVariableDefinitions({
			power_button_text: {
				name: 'Power Button Text',
			},
			lock_button_text: {
				name: 'Lock Button Text',
			},
			...inputVars,
			...outputVars,
		})
		;(this as any).setVariableValues({
			power_button_text: this.isPoweredOn ? 'ETEINDRE' : 'ALLUMER',
			lock_button_text: this.isPanelLocked ? 'DEVERROUILLER' : 'VERROUILLER',
		})
	}

	private async fetchVideoStatus(): Promise<void> {
		try {
			this.log('debug', `Fetching video status from http://${this.config.host}/cgi-bin/instr`)
			const respond = await fetch(`http://${this.config.host}/cgi-bin/instr`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/x-www-form-urlencoded',
				},
				body: JSON.stringify({ comhead: 'get video status', language: 0 }),
			})
			const text = await respond.text()
			const data = JSON.parse(text)

			const values: Record<string, string> = {}

			// Noms des entrées
			if (data.allinputname) {
				data.allinputname.forEach((name: string, index: number) => {
					values[`input_${index + 1}_name`] = name
					this.inputNames.set(index + 1, name)
				})
				this.log('debug', `Inputs mis à jour: ${data.allinputname.join(', ')}`)
			}

			// Noms des sorties
			if (data.alloutputname) {
				data.alloutputname.slice(0, 16).forEach((name: string, index: number) => {
					values[`output_${index + 1}_name`] = name
					this.outputNames.set(index + 1, name)
				})
				this.log('debug', `Outputs mis à jour: ${data.alloutputname.slice(0, 16).join(', ')}`)
			}

			// Routing actuel — allsource[i] = input assigné à output i+1
			if (data.allsource) {
				data.allsource.slice(0, 16).forEach((input: number, index: number) => {
					const output = String(index + 1)
					this.currentRouting.set(output, String(input))
				})
				;(this as any).checkFeedbacks('route_active')
				this.log('debug', `Routing mis à jour depuis allsource`)
			}

			;(this as any).setVariableValues(values)
		} catch (e) {
			this.log('error', `Erreur fetchVideoStatus: ${e}`)
		}
		this.refreshChoices()
	}

	private getInputChoices(): { id: string; label: string }[] {
		return Array.from({ length: 16 }, (_, i) => ({
			id: String(i + 1),
			label: `${i + 1} - ${this.inputNames.get(i + 1) ?? `Input ${i + 1}`}`,
		}))
	}

	private getOutputChoices(): { id: string; label: string }[] {
		return [
			{ id: '0', label: 'All Outputs' },
			...Array.from({ length: 16 }, (_, i) => ({
				id: String(i + 1),
				label: `${i + 1} - ${this.outputNames.get(i + 1) ?? `Output ${i + 1}`}`,
			})),
		]
	}

	private refreshChoices(): void {
		this.registerActions()
		this.registerFeedbacks()
	}

	private parseMessage(message: string): void {
		const msg = message.toLowerCase()

		// Réponse à "r power!" ou suite à un changement d'état via panneau/IR
		if (msg.includes('power on')) {
			this.isPoweredOn = true
			;(this as any).setVariableValues({
				power_button_text: 'ETEINDRE',
			})
			;(this as any).checkFeedbacks('power_state')
			this.log('debug', 'Matrix is ON')
		} else if (msg.includes('power off')) {
			this.isPoweredOn = false
			;(this as any).setVariableValues({
				power_button_text: 'ALLUMER',
			})
			;(this as any).checkFeedbacks('power_state')
			this.log('debug', 'Matrix is OFF')
		}

		// Réponse à "r lock!" ou suite à un verrouillage via panneau
		if (msg.includes('panel button lock on')) {
			this.isPanelLocked = true
			;(this as any).setVariableValues({
				lock_button_text: 'DEVERROUILLER',
			})
			;(this as any).checkFeedbacks('lock_state')
			this.log('debug', 'Panel is LOCKED')
		} else if (msg.includes('panel button lock off')) {
			this.isPanelLocked = false
			;(this as any).setVariableValues({
				lock_button_text: 'VERROUILLER',
			})
			;(this as any).checkFeedbacks('lock_state')
			this.log('debug', 'Panel is UNLOCKED')
		}

		// Réponse à "r HDMI y stream!" ou suite à un changement
		const hdmiMatch = msg.match(/hdmi output (\d+) stream/)
		if (hdmiMatch) {
			const output = hdmiMatch[1]
			const isEnabled = msg.includes('enable')
			this.hdmiStreamState.set(output, isEnabled)
			;(this as any).checkFeedbacks('hdmi_stream_active')
			this.log('debug', `HDMI Output ${output} stream: ${isEnabled ? 'enabled' : 'disabled'}`)
		}

		// Réponse à "r av out y!" → "input 1 -> output 2"
		const routeMatches = msg.matchAll(/input (\d+) -> output (\d+)/g)
		for (const match of routeMatches) {
			const input = match[1]
			const output = match[2]
			this.currentRouting.set(output, input)
			this.log('debug', `Routing updated: Input ${input} -> Output ${output}`)
		}
		// Rafraîchit les feedbacks une seule fois après avoir tout mis à jour
		if ([...msg.matchAll(/input (\d+) -> output (\d+)/g)].length > 0) {
			;(this as any).checkFeedbacks('route_active')
		}
	}

	private connectTCP(config: LindyConfig): void {
		this.tcp = new TCPHelper(config.host, config.port)

		this.tcp.on('connect', () => {
			this.updateStatus(InstanceStatus.Ok)
			this.log('info', 'Connected to Lindy matrix')
			this.sendCommand('r power!')
			this.sendCommand('r lock!')
			this.sendCommand('r av out 0!')
			for (let output = 1; output <= 16; output++) {
				this.sendCommand(`r HDMI ${output} stream!`)
			}

			this.tcp?.on('data', (data) => {
				const message = data.toString().trim()
				this.log('debug', `Received: ${message}`)
				this.parseMessage(message)
			})
		})

		this.tcp.on('error', (err: Error) => {
			this.updateStatus(InstanceStatus.ConnectionFailure)
			this.log('error', `TCP error: ${err.message}`)
		})

		this.tcp.on('data', (data) => {
			const message = data.toString().trim()

			this.log('debug', `Received: ${message}`)

			/*this.parseMessage(message)*/
		})
	}

	private sendCommand(cmd: string): void {
		if (this.tcp && this.tcp.isConnected) {
			this.tcp.send(cmd + '\r\n')
			this.log('debug', `Sent: ${cmd}`)
		} else {
			this.log('warn', 'Cannot send command: not connected')
		}
	}

	private registerActions(): void {
		;(this as any).setActionDefinitions({
			route_input: {
				name: 'Route Input to Output',
				options: [
					{ type: 'dropdown', id: 'input', label: 'Input', default: '1', choices: this.getInputChoices() },
					{ type: 'dropdown', id: 'output', label: 'Output', default: '1', choices: this.getOutputChoices() },
				],
				callback: async (action: any) => {
					const input = String(action.options.input)
					const output = String(action.options.output)
					this.sendCommand(`s in ${input} av out ${output}!`)
					if (output === '0') {
						for (let i = 1; i <= 16; i++) this.currentRouting.set(String(i), input)
					} else {
						this.currentRouting.set(output, input)
					}
					;(this as any).checkFeedbacks('route_active')
				},
			},

			power: {
				name: 'Power On/Off',
				options: [
					{
						type: 'dropdown',
						id: 'state',
						label: 'State',
						default: '1',
						choices: [
							{ id: '1', label: 'Power On' },
							{ id: '0', label: 'Power Off' },
							{ id: '2', label: 'Toggle' },
						],
					},
				],
				callback: async (action: any) => {
					let state = action.options.state
					this.sendCommand(`s power ${state}!`)
					if (state === '2') {
						state = this.isPoweredOn ? '0' : '1'
					}
					this.sendCommand(`s power ${state}!`)
					this.sendCommand('r power!')
				},
			},

			recall_preset: {
				name: 'Preset Recall',
				options: [{ type: 'dropdown', id: 'preset', label: 'Preset', default: '1', choices: CHOICE_PRESETS }],
				callback: async (action: any) => {
					this.sendCommand(`s recall preset ${action.options.preset}!`)
				},
			},

			save_preset: {
				name: 'Preset Save',
				options: [{ type: 'dropdown', id: 'preset', label: 'Preset', default: '1', choices: CHOICE_PRESETS }],
				callback: async (action: any) => {
					this.sendCommand(`s save preset ${action.options.preset}!`)
				},
			},

			clear_preset: {
				name: 'Preset Clear',
				options: [{ type: 'dropdown', id: 'preset', label: 'Preset', default: '1', choices: CHOICE_PRESETS }],
				callback: async (action: any) => {
					this.sendCommand(`s clear preset ${action.options.preset}!`)
				},
			},

			hdmi_stream: {
				name: 'Enable/Disable HDMI Output Stream',
				options: [
					{ type: 'dropdown', id: 'output', label: 'Output', default: '1', choices: this.getOutputChoices() },
					{
						type: 'dropdown',
						id: 'state',
						label: 'State',
						default: '1',
						choices: [
							{ id: '1', label: 'Enable' },
							{ id: '0', label: 'Disable' },
							{ id: '2', label: 'Toggle' },
						],
					},
				],
				callback: async (action: any) => {
					const output = String(action.options.output)
					let state = String(action.options.state)

					if (state === '2') {
						const currentState = this.hdmiStreamState.get(output)

						if (currentState === undefined) {
							this.log('warn', `Unknown HDMI stream state for output ${output}`)
							return
						}

						state = currentState ? '0' : '1'
					}

					this.sendCommand(`s HDMI ${output} stream ${state}!`)
					this.sendCommand(`r HDMI ${output} stream!`)
				},
			},

			scaler_mode: {
				name: 'Define Scaler Mode',
				options: [
					{ type: 'dropdown', id: 'output', label: 'Output', default: '1', choices: this.getOutputChoices() },
					{
						type: 'dropdown',
						id: 'state',
						label: 'Mode',
						default: '1',
						choices: [
							{ id: '1', label: 'Bypass' },
							{ id: '2', label: '4K->1080p' },
							{ id: '3', label: 'Auto' },
						],
					},
				],
				callback: async (action: any) => {
					this.sendCommand(`s HDMI ${action.options.output} scaler ${action.options.state}!`)
				},
			},

			lock_panel: {
				name: 'Lock/Unlock Front Panel',
				options: [
					{
						type: 'dropdown',
						id: 'state',
						label: 'State',
						default: '2',
						choices: [
							{ id: '1', label: 'Lock' },
							{ id: '0', label: 'Unlock' },
							{ id: '2', label: 'Toggle' },
						],
					},
				],
				callback: async (action: any) => {
					let state = action.options.state
					if (state === '2') {
						state = this.isPanelLocked ? '0' : '1'
					}
					this.sendCommand(`s lock ${state}!`)
					this.sendCommand('r lock!')
				},
			},

			edid: {
				name: 'Set EDID for Input',
				options: [
					{ type: 'dropdown', id: 'input', label: 'Input', default: '1', choices: this.getInputChoices() },
					{ type: 'dropdown', id: 'edid', label: 'EDID', default: '1', choices: CHOICES_EDID },
				],
				callback: async (action: any) => {
					this.sendCommand(`s edid in ${action.options.input} from ${action.options.edid}!`)
				},
			},

			reboot: {
				name: 'Reboot Device',
				options: [],
				callback: async () => {
					this.sendCommand('s reboot!')
				},
			},
		})
	}

	private registerFeedbacks(): void {
		;(this as any).setFeedbackDefinitions({
			power_state: {
				type: 'boolean',
				name: 'Power',
				options: [],
				defaultStyle: {
					bgcolor: 9830400,
					color: 16777215,
				},

				callback: () => {
					return this.isPoweredOn
				},
			},

			route_active: {
				type: 'boolean',
				name: 'Route Active',
				options: [
					{ type: 'dropdown', id: 'input', label: 'Input', default: '1', choices: this.getInputChoices() },
					{ type: 'dropdown', id: 'output', label: 'Output', default: '1', choices: this.getOutputChoices() },
				],
				defaultStyle: {
					bgcolor: 3212,
					color: 16777215,
				},
				callback: (feedback: any) => {
					const input = String(feedback.options.input)
					const output = String(feedback.options.output)

					return this.currentRouting.get(output) === input
				},
			},

			lock_state: {
				type: 'boolean',
				name: 'Lock State',
				options: [],
				defaultStyle: {
					bgcolor: 360448,
					color: 16777215,
				},
				callback: () => {
					return this.isPanelLocked
				},
			},

			hdmi_stream_active: {
				type: 'boolean',
				name: 'HDMI Stream Active',
				options: [{ type: 'dropdown', id: 'output', label: 'Output', default: '1', choices: this.getOutputChoices() }],
				defaultStyle: {
					bgcolor: 9830400,
					color: 16777215,
				},
				callback: (feedback: any) => {
					const output = String(feedback.options.output)
					return this.hdmiStreamState.get(output) ?? true
				},
			},
		})
	}

	private registerPresets(): void {
		// Structure obligatoire en v2.0.4 — définit les catégories
		const structure: Array<{ id: string; name: string; definitions: any[] }> = [
			{ id: 'routing', name: 'Routing', definitions: [] },
			{ id: 'presets_cat', name: 'Presets', definitions: [] },
			{ id: 'system', name: 'System', definitions: [] },
			{ id: 'on/off', name: 'HDMI Output', definitions: [] },
		]

		const presets: Record<string, any> = {}

		for (let output = 1; output <= 16; output++) {
			const group: { id: string; type: string; name: string; presets: string[] } = {
				id: `routing_output_${output}`,
				type: 'simple',
				name: `Output ${output}`,
				presets: [],
			}
			for (let input = 1; input <= 16; input++) {
				const key = `route_${input}_${output}`
				presets[key] = {
					type: 'simple',
					name: `Input ${input} -> Output ${output}`,
					style: {
						text: `${input}-$(lindy-38359-matrix:input_${input}_name)\n-> \n${output}-$(lindy-38359-matrix:output_${output}_name)`,
						size: '12',
						color: 16777215,
						bgcolor: 3212,
					},
					steps: [
						{
							down: [
								{
									actionId: 'route_input',
									options: {
										input: String(input),
										output: String(output),
									},
								},
							],
							up: [],
						},
					],
					feedbacks: [
						{
							feedbackId: 'route_active',
							options: {
								input: String(input),
								output: String(output),
							},
							style: {
								bgcolor: 360448,
								color: 16777215,
							},
						},
					],
				}
				group.presets.push(key)
			}
			structure[0].definitions.push(group)
		}

		// 16 boutons recall preset
		for (let i = 1; i <= 16; i++) {
			presets[`recall_preset_${i}`] = {
				type: 'simple',
				name: `Recall Preset ${i}`,
				style: {
					text: `PRESET\n${i}`,
					size: '14',
					color: 16777215,
					bgcolor: 5242880,
				},
				steps: [
					{
						down: [
							{
								actionId: 'recall_preset',
								options: { preset: String(i) },
							},
						],
						up: [],
					},
				],
				feedbacks: [],
			}
			structure[1].definitions.push(`recall_preset_${i}`)
		}

		// Bouton power toggle
		presets['power_toggle'] = {
			type: 'simple',
			name: 'Power Toggle',
			style: {
				text: 'ON',
				size: '14',
				color: 16777215,
				bgcolor: 9830400,
			},
			steps: [
				{
					down: [
						{
							actionId: 'power',
							options: {
								state: '2',
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'power_state',
					options: {},
					style: {
						bgcolor: 360448,
						color: 16777215,
						text: 'OFF',
						size: '14',
					},
				},
			],
		}
		structure[2].definitions.push('power_toggle')

		presets['lock_toggle'] = {
			type: 'simple',
			name: 'Lock Panel Toggle',
			style: {
				text: 'Lock Panel',
				size: '10',
				color: 16777215,
				bgcolor: 360448,
			},
			steps: [
				{
					down: [
						{
							actionId: 'lock_panel',
							options: {
								state: '2',
							},
						},
					],
					up: [],
				},
			],
			feedbacks: [
				{
					feedbackId: 'lock_state',
					options: {},
					style: {
						bgcolor: 9830400,
						color: 16777215,
						text: 'Unlock Panel',
					},
				},
			],
		}
		structure[2].definitions.push('lock_toggle')

		for (let output = 1; output <= 16; output++) {
			const key = `hdmi_stream_toggle_${output}`
			presets[key] = {
				type: 'simple',
				name: `HDMI Stream Toggle Output ${output}`,
				style: {
					text: `HDMI ${output}\n turn ON`,
					size: '14',
					color: 16777215,
					bgcolor: 9830400,
				},
				steps: [
					{
						down: [
							{
								actionId: 'hdmi_stream',
								options: { output: String(output), state: '2' },
							},
						],
						up: [],
					},
				],
				feedbacks: [
					{
						feedbackId: 'hdmi_stream_active',
						options: { output: String(output) },
						style: {
							bgcolor: 360448,
							color: 16777215,
							text: `HDMI ${output}\n turn OFF`,
						},
					},
				],
			}
			structure[3].definitions.push(key)
		}

		// Bouton reboot
		presets['reboot'] = {
			type: 'simple',
			name: 'Reboot Matrix',
			style: {
				text: 'REBOOT',
				size: '14',
				color: 16777215,
				bgcolor: 9830400,
			},
			steps: [
				{
					down: [{ actionId: 'reboot', options: {} }],
					up: [],
				},
			],
			feedbacks: [],
		}
		structure[2].definitions.push('reboot')

		console.log('Structure =', structure)
		console.log('Nombre de presets =', Object.keys(presets).length)

		for (const [id, preset] of Object.entries(presets)) {
			if (!preset) {
				console.log('Preset undefined :', id)
			}
		}

		// Deux arguments obligatoires : structure + presets
		;(this as any).setPresetDefinitions(structure, presets)
	}
}

export default LindyMatrixInstance
//tetsttstststs
