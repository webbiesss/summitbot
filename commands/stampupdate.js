const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('stampupdate')
        .setDescription('Update a climber’s summit stamps')
        .addUserOption(option =>
            option.setName('climber')
                .setDescription('The climber to update')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('amount')
                .setDescription('Number of summit stamps to add')
                .setRequired(true)),

    async execute(interaction) {

        // ==========================================
        // REQUIRED ROLE FOR /STAMPUPDATE
        // ==========================================

        const requiredRoleId = '827956660638318592';

        const commandUser = interaction.member;

        const requiredRole = interaction.guild.roles.cache.get(requiredRoleId);

        if (!requiredRole) {
            console.error('The required role for /stampupdate could not be found.');

            return interaction.reply({
                content: 'There is a configuration error with this command.',
                ephemeral: true
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
        // GET CLIMBER AND AMOUNT
        // ==========================================

        const climber = interaction.options.getUser('climber');
        const amount = interaction.options.getInteger('amount');


        // ==========================================
        // DATABASE
        // ==========================================

        const dbPath = path.join(__dirname, '..', 'data', 'climbers.json');

        let db = JSON.parse(fs.readFileSync(dbPath));

        if (!db[climber.id]) {
            db[climber.id] = { summits: 0 };
        }

        const initialTotal = db[climber.id].summits;

        // Add summit stamps
        db[climber.id].summits += amount;

        const total = db[climber.id].summits;

        // Save database
        fs.writeFileSync(
            dbPath,
            JSON.stringify(db, null, 2)
        );


        // ==========================================
        // LEVEL REQUIREMENTS
        // ==========================================

        let improvingclimber = 2;
        let intermediateclimber = 5;
        let experiencedclimber = 9;
        let advancedclimber = 14;
        let eliteclimber = 20;


        // ==========================================
        // CLIMBER ROLES
        // ==========================================

        const roles = {
            climber: '827956665989988402',

            improving: '827956665424281690',

            intermediate: '827956664878891018',

            experienced: '827956663902273548',

            advanced: '827956663721001010',

            elite: '827956662748315660'
        };


        // ==========================================
        // DETERMINE OLD LEVEL
        // ==========================================

        function getLevel(summits) {

            if (summits >= eliteclimber) {
                return {
                    name: 'Elite Climber',
                    roleId: roles.elite
                };
            }

            if (summits >= advancedclimber) {
                return {
                    name: 'Advanced Climber',
                    roleId: roles.advanced
                };
            }

            if (summits >= experiencedclimber) {
                return {
                    name: 'Experienced Climber',
                    roleId: roles.experienced
                };
            }

            if (summits >= intermediateclimber) {
                return {
                    name: 'Intermediate Climber',
                    roleId: roles.intermediate
                };
            }

            if (summits >= improvingclimber) {
                return {
                    name: 'Improving Climber',
                    roleId: roles.improving
                };
            }

            return {
                name: 'Climber',
                roleId: roles.climber
            };
        }


        const oldLevel = getLevel(initialTotal);
        const newLevel = getLevel(total);


        // ==========================================
        // DETECT LEVEL UP
        // ==========================================

        const leveledUp =
            oldLevel.name !== newLevel.name;


        // ==========================================
        // GET DISCORD MEMBER
        // ==========================================

        const member = await interaction.guild.members.fetch(climber.id);


        // ==========================================
        // REMOVE ALL CLIMBER LEVEL ROLES
        // ==========================================

        const allClimberRoles = [
            roles.climber,
            roles.improving,
            roles.intermediate,
            roles.experienced,
            roles.advanced,
            roles.elite
        ];

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


        // ==========================================
        // GIVE ONLY HIGHEST QUALIFYING ROLE
        // ==========================================

        await member.roles.add(newLevel.roleId)
            .catch(error => {
                console.error(
                    `Could not add role ${newLevel.roleId}:`,
                    error
                );
            });


        // ==========================================
        // CREATE RESPONSE
        // ==========================================

        let description;

        if (leveledUp) {

            description =
                `Updated ${climber} summit stamps by **${amount}**.\n\n` +
                `**${initialTotal} ➜ ${total} 🏔️**\n\n` +
                `🎉 **LEVEL UP!**\n${climber} has leveled up\n` +
                `**${oldLevel.name}** ➜ **${newLevel.name}**`;

        } else {

            description =
                `Updated ${climber} summit stamps by **${amount}**.\n\n` +
                `**${initialTotal} ➜ ${total} 🏔️**\n\n` +
                `Current Level: **${newLevel.name}**`;

        }


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