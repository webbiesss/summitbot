const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stampupdate')
        .setDescription('Update up to 10 climbers’ summit stamps')
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of summit stamps to add to each climber')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('climber1')
                .setDescription('The first climber to update')
                .setRequired(true))
        .addUserOption(option =>
            option.setName('climber2')
                .setDescription('A second climber to update'))
        .addUserOption(option =>
            option.setName('climber3')
                .setDescription('A third climber to update'))
        .addUserOption(option =>
            option.setName('climber4')
                .setDescription('A fourth climber to update'))
        .addUserOption(option =>
            option.setName('climber5')
                .setDescription('A fifth climber to update'))
        .addUserOption(option =>
            option.setName('climber6')
                .setDescription('A sixth climber to update'))
        .addUserOption(option =>
            option.setName('climber7')
                .setDescription('A seventh climber to update'))
        .addUserOption(option =>
            option.setName('climber8')
                .setDescription('An eighth climber to update'))
        .addUserOption(option =>
            option.setName('climber9')
                .setDescription('A ninth climber to update'))
        .addUserOption(option =>
            option.setName('climber10')
                .setDescription('A tenth climber to update')),

    async execute(interaction) {

        // ==========================================
        // REQUIRED ROLE FOR /STAMPUPDATE
        // ==========================================

        const { getRoleId } = require('../utils/config');

        const requiredRoleId = getRoleId('guide');

        const commandUser = interaction.member;

        const requiredRole = interaction.guild.roles.cache.get(requiredRoleId);

        if (!requiredRole) {
            console.error('The required role for /stampupdate could not be found.');

            return interaction.reply({
                content: 'There is a configuration error with this command.'
            });
        }

        // Check if the user has the required role or a role higher than it
        const hasPermission = commandUser.roles.cache.some(
            role => role.position >= requiredRole.position
        );

        if (!hasPermission) {
            const permissionEmbed = new EmbedBuilder()
                .setTitle('World Expeditions')
                .setDescription('you do not have permission to run that command')
                .setColor(0xFF0000);

            return interaction.reply({
                embeds: [permissionEmbed],
                ephemeral: true
            });
        }


        // ==========================================
        // GET CLIMBERS AND AMOUNT
        // ==========================================

        const amount = interaction.options.getInteger('amount');
        const climbers = [];

        for (let i = 1; i <= 10; i++) {
            const climber = interaction.options.getUser(`climber${i}`);

            if (climber) {
                climbers.push(climber);
            }
        }

        const uniqueClimbers = [...new Map(
            climbers.map(climber => [climber.id, climber])
        ).values()];

        if (uniqueClimbers.length === 0) {
            return interaction.reply({
                content: 'You must provide at least one climber to update.',
                ephemeral: true
            });
        }


        // ==========================================
        // DATABASE
        // ==========================================

        // ==========================================
        // LEVEL REQUIREMENTS
        // ==========================================

        const improvingclimber = 2;
        const intermediateclimber = 5;
        const experiencedclimber = 9;
        const advancedclimber = 14;
        const eliteclimber = 20;



        // ==========================================
        // CLIMBER ROLES
        // ==========================================

        const roles = {
            climber: '827956665989988402',
            improving: '827956665424281690',
            intermediate: '827956664878891018',
            experienced: '827956663902273548',
            advanced: '827956663721001010',
            elite: '827956662748315660',
            fox: '1546165459672637492',
            masterClimber: '1546181779499782174',
            worldianSherpa: '1546190004131336254',
            brownBear: '1546167615804678164',
            peakAscender: '1546190103783673897',
            snowLeopard: '1546168340563755128',
            worldianGrandAscender: '1546190336911736873',
            goldenEagle: '1546175638426091600',
            alpineIbex: '1546179136337223890',
            worldZenithConqueror: '1546190408734875678',
            worldSummitVessel: '1546190619960021052'
        };


        // ==========================================
        // DETERMINE OLD LEVEL
        // ==========================================

        function getLevel(summits) {
            if (summits >= 3000) {
                return {
                    name: 'World Zenith Conqueror',
                    roleIds: [roles.worldZenithConqueror, roles.worldSummitVessel]
                };
            }

            if (summits >= 2500) {
                return { name: 'alpine ibex (G.O.A.T)', roleIds: [roles.alpineIbex] };
            }

            if (summits >= 1500) {
                return { name: 'golden eagle', roleIds: [roles.goldenEagle] };
            }

            if (summits >= 1000) {
                return { name: 'Worldian Grand Ascender', roleIds: [roles.worldianGrandAscender] };
            }

            if (summits >= 750) {
                return { name: 'snow leopard', roleIds: [roles.snowLeopard] };
            }

            if (summits >= 500) {
                return { name: 'Peak Ascender', roleIds: [roles.peakAscender] };
            }

            if (summits >= 350) {
                return { name: 'brown bear', roleIds: [roles.brownBear] };
            }

            if (summits >= 100) {
                return { name: 'Worldian Sherpa', roleIds: [roles.worldianSherpa] };
            }

            if (summits >= 75) {
                return { name: 'Master Climber', roleIds: [roles.masterClimber] };
            }

            if (summits >= 50) {
                return { name: 'fox', roleIds: [roles.fox] };
            }

            if (summits >= eliteclimber) {
                return {
                    name: 'Elite Climber',
                    roleIds: [roles.elite]
                };
            }

            if (summits >= advancedclimber) {
                return {
                    name: 'Advanced Climber',
                    roleIds: [roles.advanced]
                };
            }

            if (summits >= experiencedclimber) {
                return {
                    name: 'Experienced Climber',
                    roleIds: [roles.experienced]
                };
            }

            if (summits >= intermediateclimber) {
                return {
                    name: 'Intermediate Climber',
                    roleIds: [roles.intermediate]
                };
            }

            if (summits >= improvingclimber) {
                return {
                    name: 'Improving Climber',
                    roleIds: [roles.improving]
                };
            }

            return {
                name: 'Climber',
                roleIds: [roles.climber]
            };
        }

        const dbPath = path.join(__dirname, '..', 'data', 'climbers.json');
        const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

        const updateResults = [];

        for (const climber of uniqueClimbers) {
            if (!db[climber.id]) {
                db[climber.id] = { summits: 0 };
            }

            const initialTotal = db[climber.id].summits;
            db[climber.id].summits += amount;
            const total = db[climber.id].summits;

            const oldLevel = getLevel(initialTotal);
            const newLevel = getLevel(total);
            const leveledUp = oldLevel.name !== newLevel.name;

            const member = await interaction.guild.members.fetch(climber.id);

            const allClimberRoles = Object.values(roles);

            for (const roleId of allClimberRoles) {
                if (member.roles.cache.has(roleId)) {
                    await member.roles.remove(roleId)
                        .catch(error => {
                            console.error(
                                `Could not remove role ${roleId}:`,
                                error
                            );
                        });
                }
            }

            for (const roleId of newLevel.roleIds) {
                await member.roles.add(roleId)
                    .catch(error => {
                        console.error(
                            `Could not add role ${roleId}:`,
                            error
                        );
                    });
            }

            updateResults.push({
                climber,
                initialTotal,
                total,
                oldLevel,
                newLevel,
                leveledUp
            });
        }

        fs.writeFileSync(
            dbPath,
            JSON.stringify(db, null, 2)
        );


        // ==========================================
        // CREATE RESPONSE
        // ==========================================

        const summaryText = updateResults
            .map(({ climber, initialTotal, total, leveledUp, oldLevel, newLevel }) => {
                const levelLine = leveledUp
                    ? `🎉 **LEVEL UP!** ${climber} has leveled up from ${oldLevel.name} to ${newLevel.name}`
                    : `Current level: **${newLevel.name}**`;

                return `• ${climber}: **${initialTotal} ➜ ${total} 🏔️** • ${levelLine}`;
            })
            .join('\n');

        const description =
            `Updated ${uniqueClimbers.length} climber${uniqueClimbers.length === 1 ? '' : 's'} by **${amount}** summit stamps each.\n\n` +
            summaryText;


        // ==========================================
        // SEND EMBED
        // ==========================================

        const embed = new EmbedBuilder()
            .setTitle('World Expeditions Guide Department')
            .setDescription(description)
            .setColor(0x00AEFF)
            .setFooter({
                text: `Logged by ${interaction.user.username} • ${new Date().toISOString()}`
            });

        await interaction.reply({
            embeds: [embed]
        });
    }
};